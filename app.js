// Add console logging to help diagnose issues
console.log("Starting application initialization...");

// Firebase configuration is loaded from config.js
// First, check if the config is properly loaded
try {
    console.log("Checking Firebase config:", typeof firebaseConfig !== 'undefined' ? "Config exists" : "Config missing");
} catch (e) {
    console.error("Error checking firebaseConfig:", e);
}

// Initialize Firebase with additional error handling
try {
    if (typeof firebaseConfig !== 'undefined') {
        console.log("Initializing Firebase...");
        firebase.initializeApp(firebaseConfig);
        console.log("Firebase initialized successfully");
    } else {
        console.error('Firebase configuration missing. Please ensure config.js is loaded correctly.');
        // Define a mock Firebase implementation for testing
        window.firebase = {
            auth: () => ({
                onAuthStateChanged: (cb) => { 
                    console.log("Mock auth state change called"); 
                    cb(null); 
                    return () => {}; 
                },
                signInWithEmailAndPassword: () => Promise.reject(new Error('Firebase not configured')),
                createUserWithEmailAndPassword: () => Promise.reject(new Error('Firebase not configured')),
                signOut: () => Promise.resolve()
            }),
            firestore: () => ({
                collection: () => ({
                    doc: () => ({
                        get: () => Promise.resolve({exists: false, data: () => ({})}),
                        set: () => Promise.resolve(),
                        update: () => Promise.resolve()
                    })
                }),
                FieldValue: {
                    serverTimestamp: () => new Date().toISOString()
                }
            })
        };
        console.log("Created mock Firebase implementation");
    }
} catch (error) {
    console.error("Error initializing Firebase:", error);
    // Create mock implementation as fallback
    window.firebase = {
        auth: () => ({
            onAuthStateChanged: (cb) => { cb(null); return () => {}; },
            signInWithEmailAndPassword: () => Promise.reject(new Error('Firebase initialization failed')),
            createUserWithEmailAndPassword: () => Promise.reject(new Error('Firebase initialization failed')),
            signOut: () => Promise.resolve()
        }),
        firestore: () => ({
            collection: () => ({
                doc: () => ({
                    get: () => Promise.resolve({exists: false, data: () => ({})}),
                    set: () => Promise.resolve(),
                    update: () => Promise.resolve()
                })
            }),
            FieldValue: {
                serverTimestamp: () => new Date().toISOString()
            }
        })
    };
    console.log("Created fallback mock Firebase implementation after error");
}

// Get Firebase services with error logging
let auth, db;
try {
    console.log("Getting Firebase services...");
    auth = firebase.auth();
    db = firebase.firestore();
    console.log("Firebase services obtained successfully");
} catch (error) {
    console.error("Error getting Firebase services:", error);
}

// User state variables
let currentUser = null;
let userProgress = {};

// Global variables
let vocabulary = [];
let currentWords = [];
let currentIndex = 0;
let categories = [];
let learnedWords = new Set();
let sheetData = {}; // Store data by sheet

// SRS Variables
let srsData = {};
let currentCategory = 'all';

// Define spaced repetition intervals (in days) for each level
const srsIntervals = {
  0: 0,     // New word - review immediately
  1: 1,     // Review after 1 day
  2: 3,     // Review after 3 days
  3: 7,     // Review after 1 week
  4: 14,    // Review after 2 weeks
  5: 30     // Review after 1 month
};

// DOM elements - with error handling for missing elements
console.log("Getting DOM elements...");
function getElement(id, fallback = null) {
    const element = document.getElementById(id);
    if (!element) {
        console.warn(`Element with ID "${id}" not found in the DOM`);
        // Return a mock element if the real one doesn't exist
        return fallback || {
            addEventListener: () => console.warn(`Attempted to add listener to missing element: ${id}`),
            style: {},
            classList: {
                add: () => {},
                remove: () => {},
                toggle: () => {},
                contains: () => false
            },
            innerHTML: '',
            textContent: ''
        };
    }
    return element;
}

const flashcard = getElement('flashcard');
const wordElement = getElement('word');
const translationElement = getElement('translation');
const prevButton = getElement('prev');
const nextButton = getElement('next');
const flipButton = getElement('flip');
const dataInfo = getElement('data-info');
const sheetsInfo = getElement('sheets-info');
const statusIndicator = getElement('status-indicator');
const categoriesContainer = getElement('categories');
const progressBar = getElement('progress');
const progressText = getElement('progress-text');
const learnedCountElement = getElement('learned-count');
const remainingCountElement = getElement('remaining-count');
const totalCountElement = getElement('total-count');

// Learning Mode DOM Elements
const flashcardModeButton = getElement('flashcard-mode-button');
const testModeButton = getElement('test-mode-button');
const flashcardContainer = getElement('flashcard-container');
const testContainer = getElement('test-container');
const matchingGame = getElement('matching-game');
const arabicColumn = getElement('arabic-column');
const hebrewColumn = getElement('hebrew-column');
const testFeedback = getElement('test-feedback');

// Reset Progress DOM Elements
const resetProgressBtn = getElement('reset-progress-btn');
const confirmResetContainer = getElement('confirm-reset-container');
const confirmResetYes = getElement('confirm-reset-yes');
const confirmResetNo = getElement('confirm-reset-no');

// Test Mode Variables
let testWords = [];
let selectedArabicItem = null;
let selectedHebrewItem = null;
let matchedPairs = 0;
const TEST_PAIR_COUNT = 6; // Number of word pairs in the test

console.log("All DOM elements initialized");

// SRS Functions
// Function to calculate next review date based on SRS level
function calculateNextReview(level) {
  const today = new Date();
  const nextDate = new Date();
  nextDate.setDate(today.getDate() + srsIntervals[level]);
  return nextDate;
}

// Function to initialize SRS data for a word
function initializeSRS(wordId) {
  return {
    level: 0,
    lastReviewed: null,
    nextReview: new Date(), // Due immediately
    failCount: 0
  };
}

// Function to update SRS data when a word is matched
function updateSRS(wordId, isCorrect) {
  try {
    // Get current SRS data or initialize if it doesn't exist
    const srs = srsData[wordId] || initializeSRS(wordId);
    const today = new Date();
    
    if (isCorrect) {
      // Word was matched correctly - move up a level (max 5)
      srs.level = Math.min(5, srs.level + 1);
    } else {
      // Word was difficult - move down a level (min 0)
      srs.level = Math.max(0, srs.level - 1);
      srs.failCount = (srs.failCount || 0) + 1;
    }
    
    // Update review timestamps
    srs.lastReviewed = today;
    srs.nextReview = calculateNextReview(srs.level);
    
    // Update the global srsData object
    srsData[wordId] = srs;
    
    // Save to Firebase if user is logged in
    if (currentUser) {
      saveSRSToFirebase(wordId, srs);
    } else {
      // If not logged in, save to localStorage
      saveToLocalStorage();
    }
    
    return srs;
  } catch (error) {
    console.error("Error in updateSRS:", error);
    return initializeSRS(wordId);
  }
}

// Function to check if a word is due for review
function isDueForReview(wordId) {
  const srs = srsData[wordId];
  if (!srs || !srs.nextReview) return true; // New words are always due
  
  const today = new Date();
  return new Date(srs.nextReview) <= today;
}

// Function to get words due for review today
function getDueWords() {
  return vocabulary.filter(word => isDueForReview(word.id));
}

// Function to prioritize words for the matching game
function prioritizeMatchingWords(words) {
  return [...words].sort((a, b) => {
    // First priority: Words due for review today
    const aIsDue = isDueForReview(a.id);
    const bIsDue = isDueForReview(b.id);
    
    if (aIsDue && !bIsDue) return -1;
    if (!aIsDue && bIsDue) return 1;
    
    // Second priority: Lower SRS level (less well known)
    const aLevel = srsData[a.id] ? srsData[a.id].level : 0;
    const bLevel = srsData[b.id] ? srsData[b.id].level : 0;
    
    if (aLevel !== bLevel) return aLevel - bLevel;
    
    // Third priority: Higher fail count (more difficult words)
    const aFails = srsData[a.id] ? srsData[a.id].failCount || 0 : 0;
    const bFails = srsData[b.id] ? srsData[b.id].failCount || 0 : 0;
    
    if (aFails !== bFails) return bFails - aFails;
    
    // Finally, sort by ID for consistency
    return a.id - b.id;
  });
}

// Save SRS data to Firebase
function saveSRSToFirebase(wordId, srsInfo) {
  if (!currentUser) return;
  
  try {
    // Create a clean object for Firebase (no Date objects)
    const srsForFirebase = {
      level: srsInfo.level,
      lastReviewed: srsInfo.lastReviewed ? srsInfo.lastReviewed.toISOString() : null,
      nextReview: srsInfo.nextReview ? srsInfo.nextReview.toISOString() : null,
      failCount: srsInfo.failCount || 0
    };
    
    // First check if the user document exists and has an srs field
    db.collection('users').doc(currentUser.uid).get()
      .then((doc) => {
        if (doc.exists) {
          // Update existing document
          return db.collection('users').doc(currentUser.uid).update({
            [`srs.${wordId}`]: srsForFirebase
          });
        } else {
          // Create new document with srs field
          let userData = {
            email: currentUser.email,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            srs: {}
          };
          userData.srs[wordId] = srsForFirebase;
          return db.collection('users').doc(currentUser.uid).set(userData);
        }
      })
      .catch(error => {
        console.error('Error saving SRS data:', error);
      });
  } catch (error) {
    console.error('Error in saveSRSToFirebase:', error);
  }
}

// Load SRS data from Firebase
function loadSRSFromFirebase() {
  if (!currentUser) return;
  
  db.collection('users').doc(currentUser.uid).get()
    .then((doc) => {
      if (doc.exists && doc.data().srs) {
        const firebaseSRS = doc.data().srs;
        
        // Convert string dates to Date objects
        Object.keys(firebaseSRS).forEach(wordId => {
          const srs = firebaseSRS[wordId];
          srsData[wordId] = {
            level: srs.level,
            lastReviewed: srs.lastReviewed ? new Date(srs.lastReviewed) : null,
            nextReview: srs.nextReview ? new Date(srs.nextReview) : null,
            failCount: srs.failCount || 0
          };
        });
        
        console.log('SRS data loaded from Firebase');
      }
    })
    .catch((error) => {
      console.error('Error loading SRS data:', error);
    });
}

// Save to localStorage when not logged in
function saveToLocalStorage() {
  try {
    // Convert Date objects to strings for localStorage
    const srsForStorage = {};
    Object.keys(srsData).forEach(wordId => {
      const srs = srsData[wordId];
      srsForStorage[wordId] = {
        level: srs.level,
        lastReviewed: srs.lastReviewed ? srs.lastReviewed.toISOString() : null,
        nextReview: srs.nextReview ? srs.nextReview.toISOString() : null,
        failCount: srs.failCount || 0
      };
    });
    
    localStorage.setItem('arabicVocabSRS', JSON.stringify(srsForStorage));
    console.log('SRS data saved to localStorage');
  } catch (error) {
    console.error('Error saving to localStorage:', error);
  }
}

// Load from localStorage when not logged in
function loadFromLocalStorage() {
  try {
    const storedSRS = localStorage.getItem('arabicVocabSRS');
    if (storedSRS) {
      const parsedSRS = JSON.parse(storedSRS);
      
      // Convert string dates back to Date objects
      Object.keys(parsedSRS).forEach(wordId => {
        const srs = parsedSRS[wordId];
        srsData[wordId] = {
          level: srs.level,
          lastReviewed: srs.lastReviewed ? new Date(srs.lastReviewed) : null,
          nextReview: srs.nextReview ? new Date(srs.nextReview) : null,
          failCount: srs.failCount || 0
        };
      });
      
      console.log('SRS data loaded from localStorage');
    }
  } catch (error) {
    console.error('Error loading from localStorage:', error);
  }
}

// Function to shuffle an array (Fisher-Yates algorithm)
function shuffleArray(array) {
  const newArray = [...array]; // Create a copy to avoid modifying the original
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

// Function to switch between modes
function switchToMode(mode) {
  console.log(`Switching to ${mode} mode`);
  try {
    if (mode === 'flashcard') {
      flashcardContainer.style.display = 'block';
      testContainer.style.display = 'none';
      flashcardModeButton.classList.add('active');
      testModeButton.classList.remove('active');
    } else if (mode === 'test') {
      flashcardContainer.style.display = 'none';
      testContainer.style.display = 'block';
      flashcardModeButton.classList.remove('active');
      testModeButton.classList.add('active');
      initializeTestMode();
    }
  } catch (error) {
    console.error(`Error switching to ${mode} mode:`, error);
  }
}

// Initialize the test mode with randomly selected words
function initializeTestMode() {
  console.log("Initializing test mode");
  try {
    // Reset test state
    testWords = [];
    selectedArabicItem = null;
    selectedHebrewItem = null;
    matchedPairs = 0;
    arabicColumn.innerHTML = '';
    hebrewColumn.innerHTML = '';
    testFeedback.textContent = '';
    
    // Add sample words if vocabulary is empty
    if (vocabulary.length === 0) {
      console.log("Empty vocabulary, adding sample words for test mode");
      vocabulary = [
        { id: 1, arabic: "مرحبا", hebrew: "שלום", category: "ברכות" },
        { id: 2, arabic: "شكرا", hebrew: "תודה", category: "ברכות" },
        { id: 3, arabic: "صباح الخير", hebrew: "בוקר טוב", category: "ברכות" },
        { id: 4, arabic: "مساء الخير", hebrew: "ערב טוב", category: "ברכות" },
        { id: 5, arabic: "كيف حالك", hebrew: "מה שלומך", category: "שיחה" },
        { id: 6, arabic: "أنا بخير", hebrew: "אני בסדר", category: "שיחה" }
      ];
    }
    
    // Get filtered vocabulary based on current category
    let availableWords = currentCategory === 'all' 
        ? vocabulary 
        : vocabulary.filter(word => word.category === currentCategory);
    
    // If we don't have enough words in this category, use all words
    if (availableWords.length < TEST_PAIR_COUNT) {
      availableWords = vocabulary;
    }
    
    // Ensure we have enough test words
    const count = Math.min(TEST_PAIR_COUNT, availableWords.length);
    testWords = shuffleArray(availableWords).slice(0, count);
    
    console.log(`Selected ${testWords.length} words for matching game`);
    
    // Create the matching game UI
    createMatchingGame(testWords);
  } catch (error) {
    console.error("Error initializing test mode:", error);
    testFeedback.textContent = "שגיאה בטעינת המבחן. נסה שוב.";
    testFeedback.style.color = '#e74c3c';
  }
}

// Create the matching game UI
function createMatchingGame(words) {
  console.log("Creating matching game with", words.length, "words");
  try {
    // Create arrays for Arabic and Hebrew items
    const arabicItems = words.map(word => ({ id: word.id, text: word.arabic }));
    const hebrewItems = words.map(word => ({ id: word.id, text: word.hebrew }));
    
    // Shuffle the arrays to randomize the order
    const shuffledArabic = shuffleArray(arabicItems);
    const shuffledHebrew = shuffleArray(hebrewItems);
    
    // Create and append elements for Arabic column
    shuffledArabic.forEach(item => {
      const element = document.createElement('div');
      element.className = 'matching-item';
      element.textContent = item.text;
      element.dataset.id = item.id;
      
      // Add SRS level class
      const srs = srsData[item.id] || { level: 0 };
      element.classList.add(`level-${srs.level}`);
      
      element.addEventListener('click', handleArabicItemClick);
      arabicColumn.appendChild(element);
    });
    
    // Create and append elements for Hebrew column
    shuffledHebrew.forEach(item => {
      const element = document.createElement('div');
      element.className = 'matching-item';
      element.textContent = item.text;
      element.dataset.id = item.id;
      
      // Add SRS level class
      const srs = srsData[item.id] || { level: 0 };
      element.classList.add(`level-${srs.level}`);
      
      element.addEventListener('click', handleHebrewItemClick);
      hebrewColumn.appendChild(element);
    });
  } catch (error) {
    console.error("Error creating matching game:", error);
  }
}

// Handle click on Arabic item
function handleArabicItemClick(event) {
  try {
    // If the item is already matched, do nothing
    if (event.currentTarget.classList.contains('matched')) {
      return;
    }
    
    // Deselect previous Arabic item if any
    if (selectedArabicItem) {
      selectedArabicItem.classList.remove('selected');
    }
    
    // Select the clicked item
    selectedArabicItem = event.currentTarget;
    selectedArabicItem.classList.add('selected');
    
    // Check for match if both columns have a selection
    if (selectedHebrewItem) {
      checkForMatch();
    }
  } catch (error) {
    console.error("Error handling Arabic item click:", error);
  }
}

// Handle click on Hebrew item
function handleHebrewItemClick(event) {
  try {
    // If the item is already matched, do nothing
    if (event.currentTarget.classList.contains('matched')) {
      return;
    }
    
    // Deselect previous Hebrew item if any
    if (selectedHebrewItem) {
      selectedHebrewItem.classList.remove('selected');
    }
    
    // Select the clicked item
    selectedHebrewItem = event.currentTarget;
    selectedHebrewItem.classList.add('selected');
    
    // Check for match if both columns have a selection
    if (selectedArabicItem) {
      checkForMatch();
    }
  } catch (error) {
    console.error("Error handling Hebrew item click:", error);
  }
}

// Check if the selected items match
function checkForMatch() {
  try {
    const arabicId = selectedArabicItem.dataset.id;
    const hebrewId = selectedHebrewItem.dataset.id;
    
    if (arabicId === hebrewId) {
      // It's a match!
      selectedArabicItem.classList.add('matched');
      selectedHebrewItem.classList.add('matched');
      selectedArabicItem.classList.remove('selected');
      selectedHebrewItem.classList.remove('selected');
      
      // Mark this word as learned
      learnedWords.add(parseInt(arabicId));
      
      // Update SRS data - correct match
      updateSRS(arabicId, true);
      
      // Update internal match count
      matchedPairs++;
      
      // Display feedback
      testFeedback.textContent = 'התאמה נכונה!';
      testFeedback.style.color = '#27ae60';
      
      // Clear selections
      selectedArabicItem = null;
      selectedHebrewItem = null;
      
      // Check if all pairs are matched
      if (matchedPairs === testWords.length) {
        // Test completed
        setTimeout(() => {
          testFeedback.textContent = 'כל הכבוד! סיימת את המבחן!';
          
          // Save progress if logged in
          if (currentUser) {
            saveUserProgress();
          }
          
          // Update stats
          updateStats();
          
          // Reset and show new words after 1.5 seconds
          setTimeout(() => {
            initializeTestMode();
          }, 1500);
        }, 500);
      }
    } else {
      // Not a match - mark both words as difficult in SRS
      updateSRS(arabicId, false);
      updateSRS(hebrewId, false);
      
      // Display feedback
      testFeedback.textContent = 'לא התאמה, נסה שוב';
      testFeedback.style.color = '#e74c3c';
      
      // Clear selections after a brief delay
      setTimeout(() => {
        if (selectedArabicItem) selectedArabicItem.classList.remove('selected');
        if (selectedHebrewItem) selectedHebrewItem.classList.remove('selected');
        selectedArabicItem = null;
        selectedHebrewItem = null;
      }, 1000);
    }
  } catch (error) {
    console.error("Error checking for match:", error);
  }
}

// Load user progress from Firestore
function loadUserProgress() {
  if (!currentUser) return;
  
  db.collection('users').doc(currentUser.uid).get()
    .then((doc) => {
      if (doc.exists && doc.data().progress) {
        userProgress = doc.data().progress;
        
        // Restore learned words from saved progress
        learnedWords = new Set();
        Object.keys(userProgress).forEach(wordId => {
          if (userProgress[wordId].learned) {
            learnedWords.add(parseInt(wordId));
          }
        });
        
        updateStats();
      }
    })
    .catch((error) => {
      console.error('Error loading user progress:', error);
    });
}

// Save user progress to Firestore
function saveUserProgress() {
  if (!currentUser) return;
  
  try {
    // Create progress object
    const progressData = {};
    
    // Save the learned state of each word
    learnedWords.forEach(wordId => {
      progressData[wordId] = {
        learned: true,
        lastSeen: firebase.firestore.FieldValue.serverTimestamp()
      };
    });
    
    // Save to Firestore
    db.collection('users').doc(currentUser.uid).update({
      progress: progressData,
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    })
    .then(() => {
      console.log('Progress saved successfully');
      // Show save indicator if you want
    })
    .catch((error) => {
      console.error('Error saving progress:', error);
    });
  } catch (error) {
    console.error('Error in saveUserProgress:', error);
  }
}

// Auth UI functions
// Show auth modal
function showAuthModal(mode = 'login') {
  try {
    const modal = document.getElementById('auth-modal');
    if (!modal) {
      console.error('Auth modal element not found');
      return;
    }
    
    modal.style.display = 'flex';
    
    // Set the active tab
    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.classList.remove('active');
    });
    
    const tabElement = document.getElementById(`${mode}-tab`);
    if (tabElement) {
      tabElement.classList.add('active');
    }
    
    // Show the active form
    document.querySelectorAll('.auth-form').forEach(form => {
      form.style.display = 'none';
    });
    
    const formElement = document.getElementById(`${mode}-form`);
    if (formElement) {
      formElement.style.display = 'block';
    }
    
    // Clear previous status messages
    const statusElement = document.getElementById('auth-status');
    if (statusElement) {
      statusElement.textContent = '';
    }
  } catch (error) {
    console.error('Error showing auth modal:', error);
  }
}

// Hide auth modal
function hideAuthModal() {
  try {
    const modal = document.getElementById('auth-modal');
    if (modal) {
      modal.style.display = 'none';
    }
  } catch (error) {
    console.error('Error hiding auth modal:', error);
  }
}

// Switch between login and register forms
function switchAuthForm(mode) {
  showAuthModal(mode);
}

// Get Hebrew error messages for firebase auth errors
function getHebrewErrorMessage(errorCode) {
  const errorMessages = {
    'auth/email-already-in-use': 'כתובת האימייל כבר בשימוש',
    'auth/invalid-email': 'כתובת אימייל לא תקינה',
    'auth/weak-password': 'הסיסמה חלשה מדי',
    'auth/user-not-found': 'משתמש לא נמצא',
    'auth/wrong-password': 'סיסמה שגויה',
    'auth/too-many-requests': 'יותר מדי נסיונות התחברות, נסה שוב מאוחר יותר'
  };
  
  return errorMessages[errorCode] || 'אירעה שגיאה. נסה שוב.';
}

// Reset user progress
function resetUserProgress() {
  if (!currentUser) return;
  
  try {
    // Clear learned words
    learnedWords = new Set();
    
    // Reset SRS data
    srsData = {};
    
    // Clear previously shown words
    localStorage.removeItem('previouslyShownMatchingWords');
    
    // Update Firebase
    db.collection('users').doc(currentUser.uid).update({
      progress: {},
      srs: {},
      lastReset: firebase.firestore.FieldValue.serverTimestamp()
    })
    .then(() => {
      console.log('Progress reset successfully');
      
      // Also clear localStorage
      localStorage.removeItem('arabicVocabSRS');
      
      // Hide confirmation dialog
      confirmResetContainer.style.display = 'none';
      
      // Update UI
      updateStats();
      
      // Refresh the current mode
      if (flashcardContainer.style.display !== 'none') {
        // Reset flashcards
        currentIndex = 0;
        updateCard();
        updateControls();
      } else {
        // Reset matching game
        initializeTestMode();
      }
      
      // Show success message
      alert('ההתקדמות שלך אופסה בהצלחה.');
    })
    .catch((error) => {
      console.error('Error resetting progress:', error);
      alert('שגיאה באיפוס ההתקדמות. נסה שוב מאוחר יותר.');
    });
  } catch (error) {
    console.error('Error in resetUserProgress:', error);
  }
}

// Flashcard functions
function flipCard() {
  console.log("Flipping card");
  try {
    flashcard.classList.toggle('flipped');
    
    // Mark as learned when flipped to see translation
    if (flashcard.classList.contains('flipped') && currentWords.length > 0) {
      const currentWord = currentWords[currentIndex];
      learnedWords.add(currentWord.id);
      updateStats();
      
      // Save progress if logged in
      if (currentUser) {
        saveUserProgress();
      }
    }
  } catch (error) {
    console.error("Error flipping card:", error);
  }
}

function showNextCard() {
  console.log("Showing next card");
  try {
    if (currentIndex < currentWords.length - 1) {
      // First ensure card is showing front side
      if (flashcard.classList.contains('flipped')) {
        // Add transition end listener to update card after flip completes
        const updateAfterFlip = function() {
          currentIndex++;
          updateCard();
          updateControls();
          flashcard.removeEventListener('transitionend', updateAfterFlip);
        };
        
        flashcard.addEventListener('transitionend', updateAfterFlip);
        flashcard.classList.remove('flipped');
      } else {
        // If already showing front, just update normally
        currentIndex++;
        updateCard();
        updateControls();
      }
    }
  } catch (error) {
    console.error("Error showing next card:", error);
  }
}

function showPreviousCard() {
  console.log("Showing previous card");
  try {
    if (currentIndex > 0) {
      // First ensure card is showing front side
      if (flashcard.classList.contains('flipped')) {
        // Add transition end listener to update card after flip completes
        const updateAfterFlip = function() {
          currentIndex--;
          updateCard();
          updateControls();
          flashcard.removeEventListener('transitionend', updateAfterFlip);
        };
        
        flashcard.addEventListener('transitionend', updateAfterFlip);
        flashcard.classList.remove('flipped');
      } else {
        // If already showing front, just update normally
        currentIndex--;
        updateCard();
        updateControls();
      }
    }
  } catch (error) {
    console.error("Error showing previous card:", error);
  }
}

function updateCard() {
  console.log("Updating card");
  try {
    if (currentWords.length === 0) {
      wordElement.textContent = 'אין מילים זמינות';
      translationElement.textContent = '';
      return;
    }
    
    const currentWord = currentWords[currentIndex];
    
    // Reset card to front side
    if (flashcard.classList.contains('flipped')) {
      flashcard.classList.remove('flipped');
    }
    
    wordElement.textContent = currentWord.arabic;
    translationElement.textContent = currentWord.hebrew;
  } catch (error) {
    console.error("Error updating card:", error);
  }
}

function updateControls() {
  try {
    prevButton.disabled = currentIndex === 0;
    nextButton.disabled = currentIndex === currentWords.length - 1;
  } catch (error) {
    console.error("Error updating controls:", error);
  }
}

function filterByCategory(category) {
  console.log("Filtering by category:", category);
  try {
    // Update active button
    document.querySelectorAll('.category-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    const categoryBtn = document.querySelector(`[data-category="${category}"]`);
    if (categoryBtn) {
      categoryBtn.classList.add('active');
    }
    
    // Remember current category
    currentCategory = category;
    
    if (category === 'all') {
      currentWords = [...vocabulary];
    } else {
      currentWords = vocabulary.filter(word => word.category === category);
    }
    
    // Shuffle the words for random order
    currentWords = shuffleArray([...currentWords]);
    
    currentIndex = 0;
    updateCard();
    updateControls();
    updateStats();
  } catch (error) {
    console.error("Error filtering by category:", error);
  }
}

function processVocabularyData(data) {
  console.log("Processing vocabulary data:", data);
  try {
    vocabulary = [];
    categories = new Set();
    
    // Assume Excel has columns: Arabic, Hebrew, Category
    data.forEach((row, index) => {
      const keys = Object.keys(row);
      let arabic = '', hebrew = '', category = 'כללי';
      
      // Try to intelligently identify the columns
      keys.forEach(key => {
        const value = row[key];
        if (!value) return;
        
        // Assuming Arabic words will be in Arabic script
        // and translations in Hebrew script
        if (typeof value === 'string') {
          if (!arabic && (key.toLowerCase().includes('arab') || key.toLowerCase() === 'word')) {
            arabic = value;
          } else if (!hebrew && (key.toLowerCase().includes('heb') || key.toLowerCase() === 'translation')) {
            hebrew = value;
          } else if (!category && key.toLowerCase().includes('cat')) {
            category = value;
          } else if (!arabic) {
            arabic = value;
          } else if (!hebrew) {
            hebrew = value;
          }
        }
      });
      
      // Fallback for simple two-column format
      if (!arabic && keys.length >= 1) arabic = row[keys[0]];
      if (!hebrew && keys.length >= 2) hebrew = row[keys[1]];
      
      // Use sheet name as category if provided and no category column exists
      if (row.sheetCategory && (!category || category === 'כללי')) {
        category = row.sheetCategory;
      }
      
      if (arabic && hebrew) {
        const wordId = index;
        vocabulary.push({
          id: wordId,
          arabic,
          hebrew,
          category
        });
        categories.add(category);
      }
    });
    
    console.log("Processed vocabulary data:", vocabulary.length, "words");
    console.log("Categories:", Array.from(categories));
    
    // Initialize with all words
    currentWords = [...vocabulary];
    
    // Shuffle the words for random order
    currentWords = shuffleArray([...currentWords]);
    
    // Create category buttons
    createCategoryButtons(Array.from(categories).sort());
    
    updateCard();
    updateControls();
    updateStats();
  } catch (error) {
    console.error("Error processing vocabulary data:", error);
    
    // Add some sample words if vocabulary processing failed
    vocabulary = [
      { id: 1, arabic: "مرحبا", hebrew: "שלום", category: "ברכות" },
      { id: 2, arabic: "شكرا", hebrew: "תודה", category: "ברכות" },
      { id: 3, arabic: "صباح الخير", hebrew: "בוקר טוב", category: "ברכות" },
      { id: 4, arabic: "مساء الخير", hebrew: "ערב טוב", category: "ברכות" },
      { id: 5, arabic: "كيف حالك", hebrew: "מה שלומך", category: "שיחה" },
      { id: 6, arabic: "أنا بخير", hebrew: "אני בסדר", category: "שיחה" }
    ];
    
    categories = new Set(['ברכות', 'שיחה']);
    currentWords = [...vocabulary];
    
    // Create category buttons
    createCategoryButtons(Array.from(categories).sort());
    
    updateCard();
    updateControls();
    updateStats();
  }
}

function createCategoryButtons(categoryList) {
  console.log("Creating category buttons:", categoryList);
  try {
    categoriesContainer.innerHTML = '<button class="category-btn active" data-category="all">הכל</button>';
    
    categoryList.forEach(category => {
      const button = document.createElement('button');
      button.className = 'category-btn';
      button.textContent = category;
      button.dataset.category = category;
      button.addEventListener('click', () => filterByCategory(category));
      categoriesContainer.appendChild(button);
    });
    
    // Add event listener to "All" button
    const allButton = categoriesContainer.querySelector('[data-category="all"]');
    if (allButton) {
      allButton.addEventListener('click', () => filterByCategory('all'));
    }
  } catch (error) {
    console.error("Error creating category buttons:", error);
  }
}

function updateStats() {
  try {
    const total = currentWords.length;
    const learned = currentWords.filter(word => learnedWords.has(word.id)).length;
    const remaining = total - learned;
    const progress = total > 0 ? Math.round((learned / total) * 100) : 0;
    
    learnedCountElement.textContent = learned;
    remainingCountElement.textContent = remaining;
    totalCountElement.textContent = total;
    progressBar.value = progress;
    progressText.textContent = `${progress}%`;
  } catch (error) {
    console.error("Error updating stats:", error);
  }
}

// Function to load the default Excel file
async function loadDefaultExcelFile() {
  console.log("Loading vocabulary data");
  dataInfo.textContent = 'טוען נתונים...';
  statusIndicator.className = 'status-indicator loading';
  
  // Sample vocabulary for fallback
  const sampleVocabulary = [
    { arabic: "مرحبا", hebrew: "שלום", category: "ברכות" },
    { arabic: "شكرا", hebrew: "תודה", category: "ברכות" },
    { arabic: "صباح الخير", hebrew: "בוקר טוב", category: "ברכות" },
    { arabic: "مساء الخير", hebrew: "ערב טוב", category: "ברכות" },
    { arabic: "كيف حالك", hebrew: "מה שלומך", category: "שיחה" },
    { arabic: "أنا بخير", hebrew: "אני בסדר", category: "שיחה" },
    { arabic: "ما اسمك", hebrew: "מה שמך", category: "שיחה" },
    { arabic: "اسمي", hebrew: "שמי", category: "שיחה" },
    { arabic: "كتاب", hebrew: "ספר", category: "חפצים" },
    { arabic: "قلم", hebrew: "עט", category: "חפצים" },
    { arabic: "طاولة", hebrew: "שולחן", category: "ריהוט" },
    { arabic: "كرسي", hebrew: "כיסא", category: "ריהוט" }
  ];
  
  try {
    // First try to load from a relative path
    let excelPaths = [
      'vocabulary.xlsx',             // In the same directory
      'data/vocabulary.xlsx',        // In a data subdirectory
      '../vocabulary.xlsx',          // One directory up
      '/vocabulary.xlsx',            // At the root
      '/arabic-vocab-app/vocabulary.xlsx' // Original path
    ];
    
    let workbook = null;
    
    // Try each path
    for (let path of excelPaths) {
      try {
        console.log(`Trying to load Excel file from: ${path}`);
        const response = await fetch(path);
        
        if (response.ok) {
          console.log(`Successfully found file at: ${path}`);
          const data = await response.arrayBuffer();
          workbook = XLSX.read(new Uint8Array(data), {type: 'array'});
          break;
        }
      } catch (err) {
        console.warn(`Failed to load from ${path}:`, err.message);
      }
    }
    
    // If no Excel file was loaded successfully, use sample data
    if (!workbook) {
      console.log("No Excel file found, using sample vocabulary");
      processVocabularyData(sampleVocabulary);
      
      // Update status to success
      statusIndicator.className = 'status-indicator success';
      dataInfo.textContent = `נטענו ${sampleVocabulary.length} מילים לדוגמה`;
      
      sheetsInfo.innerHTML = `
        <div>נטענו נתוני דוגמה (לא נמצא קובץ אקסל)</div>
        <div class="sheet-list">
          <span class="sheet-badge">דוגמה</span>
        </div>
      `;
      
      return; // Exit the function early
    }
    
    // Process the Excel data from workbook
    console.log("Successfully loaded Excel file");
    
    // Get all sheet names
    const sheetNames = workbook.SheetNames;
    console.log("Excel sheet names:", sheetNames);
    
    // Filter sheets to only those containing 'P' if specified
    const filteredSheetNames = sheetNames.filter(sheetName => sheetName.includes('P'));
    console.log("Filtered sheet names:", filteredSheetNames);
    
    // Use filtered sheets if available, otherwise use all sheets
    const sheetsToUse = filteredSheetNames.length > 0 ? filteredSheetNames : sheetNames;
    
    let allData = [];
    sheetData = {}; // Reset sheet data
    
    // Process each sheet
    sheetsToUse.forEach(sheetName => {
      const worksheet = workbook.Sheets[sheetName];
      
      // Convert to JSON
      const jsonData = XLSX.utils.sheet_to_json(worksheet);
      console.log(`Sheet ${sheetName}: ${jsonData.length} entries`);
      
      // Create display name by removing the letter 'P' if present
      let displayName = sheetName.replace(/P/g, '');
      console.log(`Display name for ${sheetName}: ${displayName}`);
      
      // Store data by sheet name
      sheetData[sheetName] = jsonData;
      
      // Add sheet name as category if not specified
      jsonData.forEach(item => {
        if (!item.category && !item.Category) {
          item.sheetCategory = displayName;
        }
      });
      
      allData = [...allData, ...jsonData];
    });
    
    console.log("Total data entries:", allData.length);
    
    if (allData.length === 0) {
      console.warn("No data found in Excel file, using sample vocabulary");
      processVocabularyData(sampleVocabulary);
      
      statusIndicator.className = 'status-indicator success';
      dataInfo.textContent = `נטענו ${sampleVocabulary.length} מילים לדוגמה`;
      
      sheetsInfo.innerHTML = `
        <div>נטענו נתוני דוגמה (קובץ אקסל ריק)</div>
        <div class="sheet-list">
          <span class="sheet-badge">דוגמה</span>
        </div>
      `;
      
      return;
    }
    
    processVocabularyData(allData);
    
    // Update status to success
    statusIndicator.className = 'status-indicator success';
    dataInfo.textContent = `נטענו ${allData.length} מילים בהצלחה`;
    
    // Get display names for the badges (without 'P')
    const displayNames = sheetsToUse.map(sheetName => sheetName.replace(/P/g, ''));
    
    // Create a detailed sheet information display with modified names
    sheetsInfo.innerHTML = `
      <div>נטענו נתונים מ-${sheetsToUse.length} גיליונות:</div>
      <div class="sheet-list">
        ${displayNames.map(sheet => `<span class="sheet-badge">${sheet}</span>`).join('')}
      </div>
    `;
    
  } catch (error) {
    console.error('Error loading Excel file:', error);
    
    // Use sample data as fallback
    processVocabularyData(sampleVocabulary);
    
    statusIndicator.className = 'status-indicator success';
    dataInfo.textContent = `נטענו ${sampleVocabulary.length} מילים לדוגמה (שגיאה בטעינת קובץ)`;
    
    sheetsInfo.innerHTML = `
      <div>שגיאה בטעינת קובץ אקסל: ${error.message}</div>
      <div class="sheet-list">
        <span class="sheet-badge">דוגמה</span>
      </div>
    `;
  }
}

// Authentication functions
function login(email, password) {
  try {
    const statusElement = document.getElementById('auth-status');
    if (!statusElement) return;
    
    statusElement.textContent = 'מתחבר...';
    
    auth.signInWithEmailAndPassword(email, password)
      .then((userCredential) => {
        // Login successful
        statusElement.textContent = 'התחברת בהצלחה!';
        statusElement.className = 'success-message';
      })
      .catch((error) => {
        // Handle errors
        statusElement.textContent = getHebrewErrorMessage(error.code);
        statusElement.className = 'error-message';
      });
  } catch (error) {
    console.error("Error in login function:", error);
  }
}

function register(email, password, passwordConfirm) {
  try {
    const statusElement = document.getElementById('auth-status');
    if (!statusElement) return;
    
    // Validate passwords match
    if (password !== passwordConfirm) {
      statusElement.textContent = 'הסיסמאות אינן תואמות';
      statusElement.className = 'error-message';
      return;
    }
    
    statusElement.textContent = 'יוצר חשבון...';
    
    auth.createUserWithEmailAndPassword(email, password)
      .then((userCredential) => {
        // Registration successful
        statusElement.textContent = 'החשבון נוצר בהצלחה!';
        statusElement.className = 'success-message';
        
        // Create initial user data
        const user = userCredential.user;
        return db.collection('users').doc(user.uid).set({
          email: user.email,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          progress: {},
          srs: {} // Initialize SRS field
        });
      })
      .catch((error) => {
        // Handle errors
        statusElement.textContent = getHebrewErrorMessage(error.code);
        statusElement.className = 'error-message';
      });
  } catch (error) {
    console.error("Error in register function:", error);
  }
}

function logout() {
  try {
    auth.signOut()
      .then(() => {
        // Sign-out successful
        learnedWords = new Set(); // Reset progress when logged out
        updateStats();
      })
      .catch((error) => {
        console.error('Logout error:', error);
      });
  } catch (error) {
    console.error("Error in logout function:", error);
  }
}

// Initialize the mode buttons
function initializeModeButtons() {
  console.log("Initializing mode buttons");
  try {
    // Flashcard mode button
    flashcardModeButton.addEventListener('click', function() {
      console.log("Flashcard mode button clicked");
      switchToMode('flashcard');
    });
    
    // Test mode button
    testModeButton.addEventListener('click', function() {
      console.log("Test mode button clicked");
      switchToMode('test');
    });
    
    // Reset progress button
    resetProgressBtn.addEventListener('click', function() {
      console.log("Reset progress button clicked");
      confirmResetContainer.style.display = 'block';
    });
    
    // Confirm reset - Yes
    confirmResetYes.addEventListener('click', function() {
      console.log("Confirm reset - Yes clicked");
      resetUserProgress();
    });
    
    // Confirm reset - No
    confirmResetNo.addEventListener('click', function() {
      console.log("Confirm reset - No clicked");
      confirmResetContainer.style.display = 'none';
    });
    
    console.log("Mode buttons initialized successfully");
  } catch (error) {
    console.error("Error initializing mode buttons:", error);
  }
}

// Auth state observer with added diagnostics
try {
  console.log("Setting up auth state observer");
  
  auth.onAuthStateChanged((user) => {
    console.log("Auth state changed:", user ? "User logged in" : "User logged out");
    
    if (user) {
      // User is signed in
      currentUser = user;
      document.getElementById('user-name').textContent = user.email;
      document.getElementById('auth-container').classList.add('logged-in');
      loadUserProgress();
      loadSRSFromFirebase(); // Load SRS data from Firebase
      hideAuthModal();
    } else {
      // User is signed out
      currentUser = null;
      document.getElementById('user-name').textContent = 'אורח';
      document.getElementById('auth-container').classList.remove('logged-in');
      learnedWords = new Set(); // Reset progress when logged out
      loadFromLocalStorage(); // Load SRS data from localStorage
      updateStats();
    }
  });
} catch (error) {
  console.error("Error setting up auth state observer:", error);
}

// Event listeners for authentication buttons
function setupAuthEventListeners() {
  console.log("Setting up auth event listeners");
  try {
    // Login button
    const loginButton = document.getElementById('login-button');
    if (loginButton) {
      loginButton.addEventListener('click', function() {
        console.log("Login button clicked");
        showAuthModal('login');
      });
    }
    
    // Register button
    const registerButton = document.getElementById('register-button');
    if (registerButton) {
      registerButton.addEventListener('click', function() {
        console.log("Register button clicked");
        showAuthModal('register');
      });
    }
    
    // Guest login button
    const guestLoginButton = document.getElementById('guest-login-button');
    if (guestLoginButton) {
      guestLoginButton.addEventListener('click', function() {
        console.log("Guest login button clicked");
        showAuthModal('login');
      });
    }
    
    // Logout button
    const logoutButton = document.getElementById('logout-button');
    if (logoutButton) {
      logoutButton.addEventListener('click', function() {
        console.log("Logout button clicked");
        logout();
      });
    }
    
    // Submit login button
    const submitLoginButton = document.getElementById('submit-login');
    if (submitLoginButton) {
      submitLoginButton.addEventListener('click', function() {
        console.log("Submit login button clicked");
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        
        if (email && password) {
          login(email, password);
        } else {
          const statusElement = document.getElementById('auth-status');
          if (statusElement) {
            statusElement.textContent = 'אנא הזן אימייל וסיסמה';
            statusElement.className = 'error-message';
          }
        }
      });
    }
    
    // Submit register button
    const submitRegisterButton = document.getElementById('submit-register');
    if (submitRegisterButton) {
      submitRegisterButton.addEventListener('click', function() {
        console.log("Submit register button clicked");
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;
        const passwordConfirm = document.getElementById('register-password-confirm').value;
        
        if (email && password && passwordConfirm) {
          register(email, password, passwordConfirm);
        } else {
          const statusElement = document.getElementById('auth-status');
          if (statusElement) {
            statusElement.textContent = 'אנא מלא את כל השדות';
            statusElement.className = 'error-message';
          }
        }
      });
    }
    
    // Add global hideAuthModal function
    window.hideAuthModal = hideAuthModal;
    
    // Add global switchAuthForm function
    window.switchAuthForm = switchAuthForm;
    
    console.log("Auth event listeners set up successfully");
  } catch (error) {
    console.error("Error setting up auth event listeners:", error);
  }
}

// Setup flashcard event listeners
function setupFlashcardEventListeners() {
  console.log("Setting up flashcard event listeners");
  try {
    // Flashcard click
    flashcard.addEventListener('click', function() {
      console.log("Flashcard clicked");
      flipCard();
    });
    
    // Flip button
    flipButton.addEventListener('click', function(event) {
      console.log("Flip button clicked");
      event.stopPropagation(); // Prevent triggering the flashcard click
      flipCard();
    });
    
    // Prev button
    prevButton.addEventListener('click', function(event) {
      console.log("Prev button clicked");
      event.stopPropagation(); // Prevent triggering the flashcard click
      showPreviousCard();
    });
    
    // Next button
    nextButton.addEventListener('click', function(event) {
      console.log("Next button clicked");
      event.stopPropagation(); // Prevent triggering the flashcard click
      showNextCard();
    });
    
    console.log("Flashcard event listeners set up successfully");
  } catch (error) {
    console.error("Error setting up flashcard event listeners:", error);
  }
}

// Main initialization function
function initializeApp() {
  console.log("Initializing app...");
  try {
    // Load SRS data
    loadFromLocalStorage();
    
    // Set up all event listeners
    setupFlashcardEventListeners();
    setupAuthEventListeners();
    initializeModeButtons();
    
    // Load vocabulary data
    loadDefaultExcelFile();
    
    // Start in flashcard mode after a short delay
    setTimeout(function() {
      switchToMode('flashcard');
    }, 1000);
    
    console.log("App initialized successfully");
  } catch (error) {
    console.error("Error initializing app:", error);
  }
}

// Execute when DOM is fully loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
  console.log("Set up DOMContentLoaded listener");
} else {
  // DOM already loaded, run initialization directly
  console.log("DOM already loaded, initializing app immediately");
  initializeApp();
}

// Make sure needed global functions are available
window.hideAuthModal = hideAuthModal;
window.switchAuthForm = switchAuthForm;
