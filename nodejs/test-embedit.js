const fs = require('fs');
const embedit = require('../js/EmbedIt');

const imageTests = [
    {
        src: 'https://gfycat.com/gifs/detail/EntireForkedArachnid',
        dst: 'EntireForkedArachnid',
    },
    {
        src: 'https://gfycat.com/EntireForkedArachnid',
        dst: 'EntireForkedArachnid',
    },
];

const redGifTests = [
    {
        src: 'https://www.redgifs.com/watch/gaseousoblongant',
        dst: 'gaseousoblongant',
    },
    {
        src: 'https://www.redgifs.com/watch/palatableflashybantamrooster-nature',
        dst: 'palatableflashybantamrooster-nature',
    },
];

function getIdTests() {
    for (let tst of imageTests) {
        var result = embedit.gfyUrlToId(tst.src);
        if(result !== tst.dst) {
            console.warn('Mismatch expected', tst.dst, result);
        } else {
            console.log('.');
        }
    }

    for (let tst of redGifTests) {
        var result = embedit.redGifUrlToId(tst.src);
        if(result !== tst.dst) {
            console.warn('Mismatch expected', tst.dst, result);
        } else {
            console.log('.');
        }
    }
}

async function redditJsonTests() {
    // const redditJson = require('../test-data/reddit.com.json');
    const redditJson = require('../test-data/reddit-image-v2.json');
    const childrenAndAfter = embedit.processRedditJson(redditJson);
    const children = childrenAndAfter.children.map(embedit.redditItemToPic);
    await fs.promises.writeFile(__dirname + '/../build/result.json', JSON.stringify(childrenAndAfter, null, 4));
    await fs.promises.writeFile(__dirname + '/../build/children.json', JSON.stringify(children, null, 4));
}

getIdTests();
redditJsonTests();
