// Simplified working version of app.js
console.log("Starting simple app.js");

// Global variables
let vocabulary = [];
let currentWords = [];
let currentIndex = 0;
let categories = new Set();
let learnedWords = new Set();

// Sample vocabulary as fallback
const sampleVocabulary = [
  { id: 1, arabic: "مرحبا", hebrew: "שלום", category: "ברכות" },
  { id: 2, arabic: "شكرا", hebrew: "תודה", category: "ברכות" },
  { id: 3, arabic: "صباح الخير", hebrew: "בוקר טוב", category: "ברכות" },
  { id: 4, arabic: "مساء الخير", hebrew: "ערב טוב", category: "ברכות" },
  { id: 5, arabic: "كيف حالك", hebrew: "מה שלומך", category: "שיחה" },
  { id: 6, arabic: "أنا بخير", hebrew: "אני בסדר", category: "שיחה" },
  { id: 7, arabic: "ما اسمك", hebrew: "מה שמך", category: "שיחה" },
  { id: 8, arabic: "اسمي", hebrew: "שמי", category: "שיחה" },
  { id: 9, arabic: "كتاب", hebrew: "ספר", category: "חפצים" },
  { id: 10, arabic: "قلم", hebrew: "עט", category: "חפצים" }
];

// DOM Elements - Get safely
function getElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    console.warn(`Element with ID '${id}' not found`);
  }
  return element;
}

// Get all the elements we need
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
const flashcardModeButton = getElement('flashcard-mode-button');
const testModeButton = getElement('test-mode-button');
const flashcardContainer = getElement('flashcard-container');
const testContainer = getElement('test-container');

// Function to shuffle an array
function shuffleArray(array) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

// Update stats display
function updateStats() {
  if (!learnedCountElement || !remainingCountElement || !totalCountElement || !progressBar || !progressText) return;
  
  const total = currentWords.length;
  const learned = currentWords.filter(word => learnedWords.has(word.id)).length;
  const remaining = total - learned;
  const progress = total > 0 ? Math.round((learned / total) * 100) : 0;
  
  learnedCountElement.textContent = learned;
  remainingCountElement.textContent = remaining;
  totalCountElement.textContent = total;
  progressBar.value = progress;
  progressText.textContent = `${progress}%`;
}

// Update the flashcard
function updateCard() {
  if (!wordElement || !translationElement) return;
  
  if (currentWords.length === 0) {
    wordElement.textContent = 'אין מילים זמינות';
    translationElement.textContent = '';
    return;
  }
  
  const currentWord = currentWords[currentIndex];
  
  // Reset card to front side
  if (flashcard && flashcard.classList.contains('flipped')) {
    flashcard.classList.remove('flipped');
  }
  
  wordElement.textContent = currentWord.arabic;
  translationElement.textContent = currentWord.hebrew;
}

// Update button states
function updateControls() {
  if (prevButton) prevButton.disabled = currentIndex === 0;
  if (nextButton) nextButton.disabled = currentIndex === currentWords.length - 1;
}

// Flip the flashcard
function flipCard() {
  if (!flashcard) return;
  
  flashcard.classList.toggle('flipped');
  
  // Mark as learned when flipped to see translation
  if (flashcard.classList.contains('flipped') && currentWords.length > 0) {
    const currentWord = currentWords[currentIndex];
    learnedWords.add(currentWord.id);
    updateStats();
  }
}

// Show the next card
function showNextCard() {
  if (currentIndex < currentWords.length - 1) {
    currentIndex++;
    updateCard();
    updateControls();
  }
}

// Show the previous card
function showPreviousCard() {
  if (currentIndex > 0) {
    currentIndex--;
    updateCard();
    updateControls();
  }
}

// Filter vocabulary by category
function filterByCategory(category) {
  // Update active button
  document.querySelectorAll('.category-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  const categoryBtn = document.querySelector(`[data-category="${category}"]`);
  if (categoryBtn) {
    categoryBtn.classList.add('active');
  }
  
  if (category === 'all') {
    currentWords = [...vocabulary];
  } else {
    currentWords = vocabulary.filter(word => word.category === category);
  }
  
  // Shuffle the words for random order
  currentWords = shuffleArray(currentWords);
  
  currentIndex = 0;
  updateCard();
  updateControls();
  updateStats();
}

// Create category buttons
function createCategoryButtons(categoryList) {
  if (!categoriesContainer) return;
  
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
}

// Switch between modes
function switchToMode(mode) {
  if (!flashcardContainer || !testContainer || !flashcardModeButton || !testModeButton) return;
  
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
    // Initialize matching game here if needed
  }
}

// Process vocabulary data
function processVocabularyData(data) {
  vocabulary = data.map((item, index) => ({
    id: index + 1,
    arabic: item.arabic,
    hebrew: item.hebrew,
    category: item.category || 'כללי'
  }));
  
  // Extract categories
  vocabulary.forEach(word => {
    if (word.category) {
      categories.add(word.category);
    }
  });
  
  // Initialize with all words
  currentWords = [...vocabulary];
  
  // Shuffle the words for random order
  currentWords = shuffleArray(currentWords);
  
  // Create category buttons
  createCategoryButtons(Array.from(categories).sort());
  
  // Update UI
  updateCard();
  updateControls();
  updateStats();
  
  // Update status
  if (statusIndicator) statusIndicator.className = 'status-indicator success';
  if (dataInfo) dataInfo.textContent = `נטענו ${vocabulary.length} מילים בהצלחה`;
  
  if (sheetsInfo) {
    sheetsInfo.innerHTML = `
      <div>נטענו ${vocabulary.length} מילים מוצלחות</div>
      <div class="sheet-list">
        <span class="sheet-badge">ברכות</span>
        <span class="sheet-badge">שיחה</span>
        <span class="sheet-badge">חפצים</span>
      </div>
    `;
  }
}

// Load sample data immediately
function loadSampleData() {
  if (statusIndicator) statusIndicator.className = 'status-indicator loading';
  if (dataInfo) dataInfo.textContent = 'טוען נתונים...';
  
  // Process sample data
  setTimeout(() => {
    processVocabularyData(sampleVocabulary);
  }, 500);
}

// Initialize mode buttons
function initializeModeButtons() {
  if (flashcardModeButton) {
    flashcardModeButton.addEventListener('click', () => switchToMode('flashcard'));
  }
  
  if (testModeButton) {
    testModeButton.addEventListener('click', () => switchToMode('test'));
  }
}

// Setup card controls
function setupCardControls() {
  if (flashcard) {
    flashcard.addEventListener('click', flipCard);
  }
  
  if (flipButton) {
    flipButton.addEventListener('click', (e) => {
      e.stopPropagation();
      flipCard();
    });
  }
  
  if (prevButton) {
    prevButton.addEventListener('click', (e) => {
      e.stopPropagation();
      showPreviousCard();
    });
  }
  
  if (nextButton) {
    nextButton.addEventListener('click', (e) => {
      e.stopPropagation();
      showNextCard();
    });
  }
}

// Initialize the app
function initializeApp() {
  console.log("Initializing simple app...");
  
  // Set up event listeners
  setupCardControls();
  initializeModeButtons();
  
  // Load sample data
  loadSampleData();
  
  // Start in flashcard mode
  switchToMode('flashcard');
  
  console.log("Simple app initialized!");
}

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', function() {
  console.log("DOM loaded, initializing app");
  initializeApp();
});

// If the DOM is already loaded, initialize immediately
if (document.readyState === 'interactive' || document.readyState === 'complete') {
  console.log("DOM already loaded, initializing app immediately");
  initializeApp();
}

// Make initialize function global so it can be called externally
window.initializeApp = initializeApp;
