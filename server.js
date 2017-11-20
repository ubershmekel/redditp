// This node server is not required, you can use index.html directly off
// the file system or a static host but you just have to use a question mark e.g.:
// http://localhost:8080/index.html?/r/gifs

var http = require('http');
var path = require('path');

var express = require('express');
 
var app = express();
 
app.set('port', process.env.PORT || 8080);

const publicFolder = [
    '.well-known',
    'css',
    'images',
    'js'
]

for (let name of publicFolder) {
    app.use('/' + name, express.static(path.join(__dirname, name)));
}

var server = http.createServer(app);
 
app.get('/*', function(req, res) {
    res.sendFile(path.join(__dirname, 'index.html'));
})
 
server.listen(app.get('port'), function(){
    console.log("Web server listening on port " + app.get('port'));
});