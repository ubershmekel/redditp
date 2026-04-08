// This node server is not required, you can use index.html directly off
// the file system or a static host but you just have to use a question mark e.g.:
// http://localhost:8080/index.html?/r/gifs

var http = require("http");
var path = require("path");

var express = require("express");

var app = express();

app.set("port", process.env.PORT || 8080);

const publicFolder = [".well-known", "css", "images", "js", "test-data"];

for (let name of publicFolder) {
  app.use("/" + name, express.static(path.join(__dirname, name)));
}

var server = http.createServer(app);

app.get("/404", function (req, res) {
  // For testing the 404 page
  res.status(404).sendFile(path.join(__dirname, "404.html"));
});

app.get("/*", function (req, res) {
  res.sendFile(path.join(__dirname, "index.html"));
});

server.listen(app.get("port"), function () {
  console.log("Web server listening at: http://localhost:" + app.get("port"));
});
