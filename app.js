var express = require('express');
var app = express();


app.use('/css', express.static(__dirname + '/css'));
app.use('/images', express.static(__dirname + '/images'));
app.use('/js', express.static(__dirname + '/js'));


// Always respond with the html, except for the above exceptions.
// Because it's a single page app.
app.get('/*', function(req, res) {
    res.sendFile(__dirname + '/index.html');
});

var port = process.env.PORT || 8080;
//app.set('port', port);


app.listen(port, function () {
    console.log('Listening on port: ' + port);
});
