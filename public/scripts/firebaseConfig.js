// Public Firebase identifiers are shared by the existing site and analytics transport.
export const firebaseConfig = {
    apiKey: "AIzaSyCqHN5ARe0uF9zBmWF90xJrWdCzbS1SxFo",
    authDomain: "demir-personal-website.firebaseapp.com",
    projectId: "demir-personal-website",
    storageBucket: "demir-personal-website.firebasestorage.app",
    messagingSenderId: "104633469125",
    appId: "1:104633469125:web:d356f795162b7536f4c8ac",
    measurementId: "G-J7SWPE8BCT"
};

// Keep the existing counters on local Firestore when serving through the Hosting emulator.
export const useFirebaseEmulators = ['localhost', '127.0.0.1'].includes(window.location.hostname)
    && window.location.port === '5050';
