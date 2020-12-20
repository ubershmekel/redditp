// eslint-disable-next-line no-redeclare
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
