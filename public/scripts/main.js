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
        // Update count in div id count
        document.getElementById('count').innerHTML = 'You have visited this page ' + localStorage.getItem(this.pageViewsKey) + ' times.'
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

