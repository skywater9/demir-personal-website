// Firebase Web SDK (loaded directly from Google's CDN for this static site).
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-analytics.js";
import { getFirestore, connectFirestoreEmulator, doc, runTransaction } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { firebaseConfig, useFirebaseEmulators } from './firebaseConfig.js';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

if (useFirebaseEmulators) {
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

async function incrementFirestoreCounter(counterId) {
    const counterRef = doc(db, "siteStats", counterId);
    return runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(counterRef);
        const currentCount = snapshot.exists() ? snapshot.data().count : 0;
        const nextCount = currentCount + 1;
        transaction.set(counterRef, { count: nextCount }, { merge: true });
        return nextCount;
    });
}

// Analytics is optional and may be unavailable in some local/privacy contexts.
if (typeof window !== "undefined") {
    getAnalytics(app);
}

class Main {
    constructor() {
        this.pageViewsKey = 'pageViewsCount';
        this.initializeCounter();
        this.displayCount();
    }

    initializeCounter() {
        if (!localStorage.getItem(this.pageViewsKey)) {
            localStorage.setItem(this.pageViewsKey, '0');
        }
    }

    incrementCount() {
        let currentCount = parseInt(localStorage.getItem(this.pageViewsKey));
        currentCount++;
        localStorage.setItem(this.pageViewsKey, currentCount.toString());
    }

    displayCount() {
        this.incrementCount();
        document.getElementById('count').innerHTML = 'You have visited this page ' + localStorage.getItem(this.pageViewsKey) + ' times.'
        incrementFirestoreCounter('visits').then((totalVisits) => {
            document.getElementById('count').innerHTML = 'Website visits: ' + totalVisits;
        }).catch((error) => {
            console.error('Could not record website visit in Firestore:', error);
        });
    }
}

// Note that we construct the class here, but we don't need to assign it to a variable.
document.mainClass = new Main();

document.getElementById("header").addEventListener('click', (event) => {
    alert('You clicked on the top button');
});


document.getElementById("header").addEventListener('mouseenter', (event) => {
    document.getElementById("header").style.backgroundColor = "#f13b08";
});

document.getElementById("header").addEventListener('mouseleave', (event) => {
    document.getElementById("header").style.backgroundColor = " #b3d9ff";
});



document.getElementById("section2").addEventListener('mouseenter', (event) => {
    document.getElementById("section2").style.backgroundColor = "#0842f1";
});

document.getElementById("section2").addEventListener('mouseleave', (event) => {
    document.getElementById("section2").style.backgroundColor = " #b3d9ff";
});

// click count
if (!localStorage.getItem('clickCount')) {
    localStorage.setItem('clickCount', '0');
}
var clickCount = parseInt(localStorage.getItem('clickCount'));
document.getElementById("clickCount").innerHTML = clickCount;
document.getElementById("section2").addEventListener('click', (event) => {
    clickCount++;
    localStorage.setItem('clickCount', clickCount.toString());
    document.getElementById("clickCount").innerHTML = clickCount;
    incrementFirestoreCounter('clicks').then((totalClicks) => {
        clickCount = totalClicks;
        document.getElementById("clickCount").innerHTML = totalClicks;
    }).catch((error) => {
        console.error('Could not record click in Firestore:', error);
    });
});

document.getElementById("resetClickCount").addEventListener('click', (event) => {
    event.stopPropagation();
    clickCount = 0;
    localStorage.setItem('clickCount', '0');
    document.getElementById("clickCount").textContent = '0';
});


document.getElementById("section3").addEventListener('mouseenter', (event) => {
    document.getElementById("section3").style.backgroundColor = "#08f11b";
});

document.getElementById("section3").addEventListener('mouseleave', (event) => {
    document.getElementById("section3").style.backgroundColor = " #b3d9ff";
});

document.getElementById("section3").addEventListener('click', (event) => {
    new Game();
});

