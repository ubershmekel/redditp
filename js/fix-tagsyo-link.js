function fixTagsyoLink() {
  var subMatch = /\/r\/([a-zA-Z_0-9\-]+)/.exec(window.location.href);
  if (!subMatch) {
      return;
  }
  var subName = subMatch[1];
  var query = "SELECT * FROM url WHERE LOWER(channel) = '" + subName + "' !slideshow";
  var tagsyoLink = "http://www.tagsyo.com/q/?q=" + encodeURIComponent(query);
  document.getElementById('tagsyo-link').href = tagsyoLink;
  console.log("fixed tagsyo link");
}

fixTagsyoLink();