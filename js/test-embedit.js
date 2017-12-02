var embedit = require('./EmbedIt');

var imageTests = [
    {
        src: 'https://gfycat.com/gifs/detail/EntireForkedArachnid',
        dst: 'EntireForkedArachnid',
    },
    {
        src: 'https://gfycat.com/EntireForkedArachnid',
        dst: 'EntireForkedArachnid',
    },
]

for (let tst of imageTests) {
    var result = embedit.gfyUrlToId(tst.src);
    if(result !== tst.dst) {
        console.warn('Mismatch expected', tst.dst, result);
    } else {
        console.log('.');
    }
}
