// Firebase configuration is loaded from config.js

// Initialize Firebase
// Check if firebaseConfig exists before initializing
if (typeof firebaseConfig !== 'undefined') {
    firebase.initializeApp(firebaseConfig);
} else {
    console.error('Firebase configuration missing. Please ensure config.js is loaded correctly.');
    // Define a fallback configuration for testing purposes
    window.firebase = {
        auth: () => ({
            onAuthStateChanged: (cb) => cb(null),
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
            })
        })
    };
}

// Get Firebase services
const auth = firebase.auth();
const db = firebase.firestore();

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

// DOM elements
const flashcard = document.getElementById('flashcard');
const wordElement = document.getElementById('word');
const translationElement = document.getElementById('translation');
const prevButton = document.getElementById('prev');
const nextButton = document.getElementById('next');
const flipButton = document.getElementById('flip');
const dataInfo = document.getElementById('data-info');
const sheetsInfo = document.getElementById('sheets-info');
const statusIndicator = document.getElementById('status-indicator');
const categoriesContainer = document.getElementById('categories');
const progressBar = document.getElementById('progress');
const progressText = document.getElementById('progress-text');
const learnedCountElement = document.getElementById('learned-count');
const remainingCountElement = document.getElementById('remaining-count');
const totalCountElement = document.getElementById('total-count');

// Learning Mode DOM Elements
const flashcardModeButton = document.getElementById('flashcard-mode-button');
const testModeButton = document.getElementById('test-mode-button');
const flashcardContainer = document.getElementById('flashcard-container');
const testContainer = document.getElementById('test-container');
const matchingGame = document.getElementById('matching-game');
const arabicColumn = document.getElementById('arabic-column');
const hebrewColumn = document.getElementById('hebrew-column');
const testFeedback = document.getElementById('test-feedback');

// Reset Progress DOM Elements
const resetProgressBtn = document.getElementById('reset-progress-btn');
const confirmResetContainer = document.getElementById('confirm-reset-container');
const confirmResetYes = document.getElementById('confirm-reset-yes');
const confirmResetNo = document.getElementById('confirm-reset-no');

// Test Mode Variables
let testWords = [];
let selectedArabicItem = null;
let selectedHebrewItem = null;
let matchedPairs = 0;
const TEST_PAIR_COUNT = 6; // Number of word pairs in the test

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
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Function to switch between modes
function switchToMode(mode) {
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
}

// Initialize the test mode with randomly selected words
function initializeTestMode() {
    // Reset test state
    testWords = [];
    selectedArabicItem = null;
    selectedHebrewItem = null;
    matchedPairs = 0;
    arabicColumn.innerHTML = '';
    hebrewColumn.innerHTML = '';
    testFeedback.textContent = '';
    
    // Get filtered vocabulary based on current category
    let availableWords = currentCategory === 'all' 
        ? vocabulary 
        : vocabulary.filter(word => word.category === currentCategory);
    
    // If we don't have enough words in this category, use all words
    if (availableWords.length < TEST_PAIR_COUNT) {
        availableWords = vocabulary;
    }
    
    // Keep track of previously shown words to increase variety
    let previouslyShownWords = JSON.parse(localStorage.getItem('previouslyShownMatchingWords')) || [];
    
    // Filter out recently shown words if we have enough options
    let remainingWords = availableWords.filter(word => !previouslyShownWords.includes(word.id));
    
    // If we have too few remaining words, reset the previously shown list
    if (remainingWords.length < TEST_PAIR_COUNT) {
        remainingWords = availableWords;
        previouslyShownWords = [];
    }
    
    // Get words due for review based on SRS
    const dueWords = remainingWords.filter(word => isDueForReview(word.id));
    
    // Prepare final words list
    let finalWords = [];
    
    // If we have enough due words, use a mix of due words and random words for variety
    if (dueWords.length >= TEST_PAIR_COUNT / 2) {
        // Use some due words (weighted by SRS priority)
        const prioritizedDueWords = prioritizeMatchingWords(dueWords);
        // Take about half of the words from due words
        const dueWordsCount = Math.min(Math.ceil(TEST_PAIR_COUNT / 2), dueWords.length);
        const selectedDueWords = prioritizedDueWords.slice(0, dueWordsCount);
        
        // Get non-due words that weren't recently shown
        const nonDueWords = remainingWords.filter(word => !isDueForReview(word.id));
        const shuffledNonDueWords = shuffleArray([...nonDueWords]);
        
        // Add random non-due words to complete the set
        const remainingCount = TEST_PAIR_COUNT - selectedDueWords.length;
        const selectedNonDueWords = shuffledNonDueWords.slice(0, remainingCount);
        
        // Combine and shuffle for final words list
        finalWords = shuffleArray([...selectedDueWords, ...selectedNonDueWords]);
    } else {
        // Not enough due words, just use random words that weren't recently shown
        const shuffledWords = shuffleArray([...remainingWords]);
        finalWords = shuffledWords.slice(0, TEST_PAIR_COUNT);
    }
    
    // If we still don't have enough words, fallback to completely random selection
    if (finalWords.length < TEST_PAIR_COUNT) {
        const shuffledAllWords = shuffleArray([...availableWords]);
        finalWords = shuffledAllWords.slice(0, TEST_PAIR_COUNT);
    }
    
    // Store the current words as previously shown
    previouslyShownWords = [...previouslyShownWords, ...finalWords.map(word => word.id)];
    // Keep only the most recent batch to avoid the list growing too large
    if (previouslyShownWords.length > TEST_PAIR_COUNT * 3) {
        previouslyShownWords = previouslyShownWords.slice(previouslyShownWords.length - TEST_PAIR_COUNT * 3);
    }
    localStorage.setItem('previouslyShownMatchingWords', JSON.stringify(previouslyShownWords));
    
    // Set the test words
    testWords = finalWords;
    
    // Create the matching game UI
    createMatchingGame(testWords);
}

// Create the matching game UI
function createMatchingGame(words) {
    // Create arrays for Arabic and Hebrew items
    const arabicItems = words.map(word => ({ id: word.id, text: word.arabic }));
    const hebrewItems = words.map(word => ({ id: word.id, text: word.hebrew }));
    
    // Shuffle the arrays to randomize the order
    shuffleArray(arabicItems);
    shuffleArray(hebrewItems);
    
    // Create and append elements for Arabic column
    arabicItems.forEach(item => {
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
    hebrewItems.forEach(item => {
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
}

// Handle click on Arabic item
function handleArabicItemClick(event) {
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
}

// Handle click on Hebrew item
function handleHebrewItemClick(event) {
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
}

// Check if the selected items match
function checkForMatch() {
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
        if (matchedPairs === TEST_PAIR_COUNT) {
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
            selectedArabicItem.classList.remove('selected');
            selectedHebrewItem.classList.remove('selected');
            selectedArabicItem = null;
            selectedHebrewItem = null;
        }, 1000);
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
}

// Show auth modal
function showAuthModal(mode = 'login') {
    const modal = document.getElementById('auth-modal');
    modal.style.display = 'flex';
    
    // Set the active tab
    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.getElementById(`${mode}-tab`).classList.add('active');
    
    // Show the active form
    document.querySelectorAll('.auth-form').forEach(form => {
        form.style.display = 'none';
    });
    document.getElementById(`${mode}-form`).style.display = 'block';
    
    // Clear previous status messages
    document.getElementById('auth-status').textContent = '';
}

// Hide auth modal
function hideAuthModal() {
    const modal = document.getElementById('auth-modal');
    modal.style.display = 'none';
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

function flipCard() {
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
}

function showNextCard() {
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
}

function showPreviousCard() {
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
}

function updateCard() {
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
}

function updateControls() {
    prevButton.disabled = currentIndex === 0;
    nextButton.disabled = currentIndex === currentWords.length - 1;
}

function filterByCategory(category) {
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
}

function processVocabularyData(data) {
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
}
