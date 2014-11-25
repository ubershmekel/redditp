function handleResponse() {
}
var gfyCollection = function () {
    var d = [];

    function b(g, j) {
        if (j.getElementsByClassName) {
            return j.getElementsByClassName(g)
        } else {
            var e = [];
            var h = j.getElementsByTagName("*");
            for (var f = 0; f < h.length; f++) {
                if ((" " + h[f].className + " ").indexOf(" " + g + " ") > -1) {
                    e.push(h[f])
                }
            }
            return e
        }
    }

    function c() {
        elem_coll = b("gfyitem", document);
        for (var e = 0; e < elem_coll.length; e++) {
            var f = new gfyObject(elem_coll[e]);
            f.init()
        }
    }

    function a() {
        return d
    }

    return {init: c, get: a}
}();
var gfyObject = function (C) {
    var ap = C;
    var n;
    var aH;
    var i;
    var aK;
    var V;
    var ao;
    var au;
    var z;
    var k;
    var aP;
    var F;
    var ay;
    var aD;
    var T;
    var ab;
    var e;
    var b;
    var t;
    var am;
    var I;
    var aA;
    var ah = false;
    var H = false;
    var q = false;
    var aF = false;
    var az = this;
    var S;
    var u;
    var h;
    var ai = 0;
    var aq = 0;
    var X = 0;
    var aj = 0;
    var y;
    var A;
    var E;
    var o;
    var D;
    var P;
    var aO;
    var at = 0;

    function B(aT, aV) {
        if (aV.getElementsByClassName) {
            return aV.getElementsByClassName(aT)
        } else {
            var aR = [];
            var aU = aV.getElementsByTagName("*");
            for (var aS = 0; aS < aU.length; aS++) {
                if ((" " + aU[aS].className + " ").indexOf(" " + aT + " ") > -1) {
                    aR.push(aU[aS])
                }
            }
            return aR
        }
    }

    function c(aR) {
        o = aR;
        gfyFrameRate = o.frameRate
    }

    function f() {
        aj = 1;
        au = document.createElement("video");
        au.className = "gfyVid";
        au.autoplay = true;
        au.loop = true;
        au.poster = true;
        au.controls = false;
        if (d() - 2 > gfyWidth) {
            au.width = gfyWidth;
            au.height = gfyHeight;
            t.width = gfyWidth;
            t.height = gfyHeight
        }
        source = document.createElement("source");
        source.src = gfyMp4Url;
        var aR = navigator.userAgent.toLowerCase();
        if (aR.indexOf("android") > -1) {
            source.src = source.src.replace(/\.mp4/g, "-android.mp4")
        }
        source.type = "video/mp4";
        source.className = "mp4source";
        au.appendChild(source);
        source2 = document.createElement("source");
        source2.src = gfyWebmUrl;
        source2.type = "video/webm";
        source2.className = "webmsource";
        au.appendChild(source2);
        au.style.position = "absolute";
        au.style.top = 0;
        au.style.left = 0;
        au.style.border = 0;
        au.style.padding = 0;
        au.style.zIndex = 25;
        ap.appendChild(au);
        au.addEventListener("error", J, true);
        au.onmouseover = j;
        au.onmouseout = U
    }

    function av() {
        z = document.createElement("img");
        z.className = "gfyGif";
        z.src = gfyGifUrl;
        t.width = 0;
        t.height = 0;
        z.style.position = "absolute";
        z.style.top = 0;
        z.style.left = 0;
        z.style.border = 0;
        z.style.padding = 0;
        z.style.zIndex = 25;
        ap.appendChild(z);
        z.onmouseover = j;
        z.onmouseout = U
    }

    function K() {
        parentElem = ap.parentNode;
        replaceElem = document.createElement("div");
        replaceElem.className = ap.className;
        replaceElem.style.cssText = ap.style.cssText;
        parentElem.insertBefore(replaceElem, ap);
        parentElem.removeChild(ap);
        wrapperElem = replaceElem;
        wrapperElem.style.display = "inline-block";
        ap.style.padding = 0;
        ap = document.createElement("div");
        wrapperElem.appendChild(ap);
        ap.style.width = gfyWidth + "px";
        ap.style.position = "relative";
        ap.style.padding = 0;
        ap.style.zIndex = 5;
        ap.style.height = gfyHeight + at + "px";
        aa();
        x();
        an()
    }

    function aa() {
        b = document.createElement("canvas");
        b.className = "gfyDotCanvas oTrans oShow";
        b.style.position = "absolute";
        b.style.right = 0;
        b.style.top = "5px";
        b.width = 35;
        b.height = 35;
        b.style.zIndex = 30;
        if (!D) {
            b.style.display = "none"
        }
        ap.appendChild(b)
    }

    function x() {
        t = document.createElement("canvas");
        t.className = "gfyPreLoadCanvas";
        t.style.position = "absolute";
        t.style.top = 0;
        t.style.left = 0;
        t.width = gfyWidth;
        t.height = gfyHeight;
        t.height = gfyHeight;
        t.style.cssText = "position: absolute; z-index: 22; top: 0px; left: 0px; -webkit-filter: blur(2px);";
        ap.appendChild(t)
    }

    function an() {
        i = document.createElement("div");
        i.className = "gfyCtrlBox";
        aK = document.createElement("img");
        aK.className = "gfyCtrlPause";
        aK.src = "http://assets.gfycat.com/img/pause.png";
        aK.width = 15;
        aK.height = 15;
        aK.style.marginLeft = "10px";
        aK.style.marginTop = "12px";
        aK.style.borderStyle = "none";
        i.appendChild(aK);
        a1 = document.createElement("a");
        ctrlReverse = document.createElement("img");
        ctrlReverse.className = "gfyCtrlReverse";
        ctrlReverse.src = "http://assets.gfycat.com/img/reverse3.png";
        ctrlReverse.width = 15;
        ctrlReverse.height = 15;
        ctrlReverse.style.marginLeft = "6px";
        ctrlReverse.style.marginTop = "12px";
        ctrlReverse.style.borderStyle = "none";
        a1.appendChild(ctrlReverse);
        i.appendChild(a1);
        a2 = document.createElement("a");
        V = document.createElement("img");
        V.className = "gfyCtrlSlower";
        V.src = "http://assets.gfycat.com/img/slower.png";
        V.width = 15;
        V.height = 15;
        V.style.marginLeft = "13px";
        V.style.marginTop = "12px";
        V.style.borderStyle = "none";
        a2.appendChild(V);
        i.appendChild(a2);
        a3 = document.createElement("a");
        ao = document.createElement("img");
        ao.className = "gfyCtrlFaster";
        ao.src = "http://assets.gfycat.com/img/faster.png";
        ao.width = 15;
        ao.height = 15;
        ao.style.marginLeft = "4px";
        ao.style.marginTop = "12px";
        ao.style.borderStyle = "none";
        a3.appendChild(ao);
        i.appendChild(a3);
        aH = document.createElement("div");
        aH.className = "gfyCtrlTabPull";
        pullTabImg = document.createElement("img");
        pullTabImg.src = "http://assets.gfycat.com/img/pulltabsmaller.png";
        pullTabImg.style.borderStyle = "0";
        aH.appendChild(pullTabImg);
        aH.style.position = "absolute";
        aH.style.right = "0";
        aH.style.bottom = "-21px";
        aH.style.margin = "0";
        aH.style.padding = "0";
        aH.style.borderStyle = "none";
        aH.style.width = "36px";
        aH.style.height = "21px";
        i.style.position = "absolute";
        i.style.right = "0px";
        i.style.bottom = at + "px";
        i.style.height = "40px";
        i.style.width = "102px";
        i.style.backgroundColor = "#0054a5";
        i.style.zIndex = "10";
        i.style.margin = "0";
        i.style.display = "none";
        i.style.lineHeight = "0";
        i.appendChild(aH);
        i.setAttribute("id", "ctr" + n);
        ap.appendChild(i)
    }

    function af() {
        gfyInfo = document.createElement("div");
        gfyInfo.className = "gfyInfo oTrans oHide";
        F = document.createElement("div");
        F.className = "gfyInfoItem";
        F.innerHTML = "Gif Size: " + aG(gfyGifSize);
        gfyInfo.appendChild(F);
        gfySize = document.createElement("div");
        gfySize.className = "gfyInfoItem";
        gfySize.innerHTML = "Gfy Size: " + aG(gfyMp4Size);
        gfyInfo.appendChild(gfySize);
        e = document.createElement("div");
        e.className = "gfyInfoItem";
        e.innerHTML = "Compression: " + Math.round(10 * gfyGifSize / gfyMp4Size) / 10 + " to 1";
        gfyInfo.appendChild(e);
        T = document.createElement("div");
        T.className = "gfyInfoItem";
        T.innerHTML = "Views: " + gfyViews;
        gfyInfo.appendChild(T);
        ap.appendChild(gfyInfo)
    }

    function ar() {
        aj = 0;
        ap.removeChild(au)
    }

    function R() {
        ap.removeChild(z)
    }

    function Z() {
        if (aj == 1) {
            if (au.paused) {
                aK.src = "http://assets.gfycat.com/img/pause.png";
                ao.src = "http://assets.gfycat.com/img/faster.png";
                V.src = "http://assets.gfycat.com/img/slower.png";
                ao.onclick = aQ;
                V.onclick = ax
            }
            ar();
            av();
            k.src = k.src.replace(/gif-icon/g, "film-icon");
            i.style.display = "none";
            Y(true);
            ae()
        } else {
            R();
            f();
            k.src = k.src.replace(/film-icon/g, "gif-icon");
            aB()
        }
    }

    function O() {
        R();
        f()
    }

    function al() {
        ar();
        av()
    }

    function aG(aT) {
        var aS = -1;
        var aR = [" kB", " MB"];
        do {
            aT = aT / 1024;
            aS++
        } while (aT > 1024);
        return Math.max(aT, 0.1).toFixed(1) + aR[aS]
    }

    function r() {
        if (document.selection) {
            var aR = document.body.createTextRange();
            aR.moveToElementText(this);
            aR.select()
        } else {
            if (window.getSelection) {
                var aR = document.createRange();
                aR.selectNode(this);
                window.getSelection().addRange(aR)
            }
        }
    }

    function v() {
        var aR = B("mp4source", au)[0].src;
        if (aR.indexOf("zippy") > -1) {
            E = "#99cf2c";
            dotRed = 50;
            dotGreen = 105;
            dotBlue = 0
        } else {
            if (aR.indexOf("fat") > -1) {
                E = "#fdc428";
                dotRed = 210;
                dotGreen = 153;
                dotBlue = 0
            } else {
                dotRed = 163;
                dotGreen = 7;
                dotBlue = 0;
                E = "#cd312a"
            }
        }
    }

    function Y(aS) {
        if (typeof gfyMp4Size === "undefined") {
            return v()
        }
        var aR;
        if (aS == true) {
            aR = gfyGifSize
        } else {
            aR = gfyMp4Size
        }
        if (aR < 1000000) {
            E = "#99cf2c";
            dotRed = 50;
            dotGreen = 105;
            dotBlue = 0
        } else {
            if (aR < 2000000) {
                E = "#fdc428";
                dotRed = 210;
                dotGreen = 153;
                dotBlue = 0
            } else {
                dotRed = 163;
                dotGreen = 7;
                dotBlue = 0;
                E = "#cd312a"
            }
        }
    }

    function aI(aS, aR) {
        return (" " + aS.className + " ").indexOf(" " + aR + " ") > -1
    }

    function aJ(aS, aR) {
        aS.className = aS.className.replace(/(^\s+|\s+$)/g, "");
        return aI(aS, aR) ? false : (aS.className += " " + aR)
    }

    function aM(aS, aR) {
        return aS.className = (" " + aS.className + " ").replace(" " + aR + " ", " ")
    }

    function Q() {
        var aR = false;
        (function (aS) {
            if (/(android|bb\d+|meego).+mobile|avantgo|bada\/|android|ipad|playbook|silk|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows (ce|phone)|xda|xiino/i.test(aS) || /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(aS.substr(0, 4))) {
                aR = true
            }
        })(navigator.userAgent || navigator.vendor || window.opera);
        return aR
    }

    function d() {
        if (window.outerWidth) {
            return window.outerHeight
        } else {
            return document.body.clientWidth
        }
    }

    function ak() {
        n = ap.getAttribute("data-id");
        data = ap.getAttribute("data-controls");
        if (data == "false") {
            P = false
        } else {
            P = true
        }
        data = ap.getAttribute("data-dot");
        if (data == "false") {
            D = false
        } else {
            D = true
        }
        data = ap.getAttribute("data-perimeter");
        if (data == "true") {
            aO = true
        } else {
            aO = false
        }
        if (aO) {
            at = 60
        }
        loadJSONP("http://gfycat.com/cajax/get/" + n, function (aR) {
            if (aR) {
                W(aR)
            } else {
            }
        })
    }

    function W(aR) {
        o = aR.gfyItem;
        gfyWidth = o.width;
        gfyHeight = o.height;
        gfyMp4Url = o.mp4Url;
        gfyWebmUrl = o.webmUrl;
        gfyFrameRate = o.frameRate;
        gfyGifUrl = o.gifUrl;
        K();
        if (Q() || !document.createElement("video").canPlayType) {
            av();
            aJ(k, "oShow");
            aM(k, "oHide")
        } else {
            f()
        }
        aH.onmouseover = aL;
        aH.onmouseout = G;
        i.onmouseover = ag;
        i.onmouseout = aN;
        ap.onmouseover = j;
        ap.onmouseout = U;
        aK.onclick = aE;
        V.onclick = ax;
        ao.onclick = aQ;
        ctrlReverse.onclick = g;
        Y();
        az.drawLoadingBeat()
    }

    function aC() {
        if (q || (!D && !P)) {
            return false
        } else {
            q = true;
            aF = false;
            clearTimeout(u);
            u = setTimeout(function () {
                az.showOpacityStep()
            }, 5)
        }
    }

    function ac() {
        if (aF || (!D && !P)) {
            return false
        } else {
            q = false;
            aF = true;
            clearTimeout(u);
            u = setTimeout(function () {
                az.hideOpacityStep()
            }, 5)
        }
    }

    this.checkCtrl = function () {
        if (am || I) {
        } else {
            N()
        }
    };
    this.checkGfyExtras = function () {
        if (aA || am || I) {
        } else {
            ac()
        }
    };
    function M() {
        if (X) {
            aJ(A, "oHide");
            aM(A, "oShow");
            X = false
        } else {
            A.style.display = "block";
            aJ(A, "oShow");
            aM(A, "oHide");
            X = true
        }
        w()
    }

    function w() {
        setTimeout(function () {
            aJ(ap, "foo");
            aM(ap, "foo")
        }, 10)
    }

    function j() {
        aA = 1;
        aC()
    }

    function U() {
        aA = 0;
        setTimeout(function () {
            az.checkGfyExtras()
        }, 1000)
    }

    function aL() {
        am = 1;
        l()
    }

    function G() {
        am = 0;
        setTimeout(function () {
            az.checkCtrl()
        }, 400)
    }

    function ag() {
        I = 1
    }

    function aN() {
        I = 0;
        setTimeout(function () {
            az.checkCtrl()
        }, 400)
    }

    function aE() {
        if (au.paused) {
            au.play();
            this.src = "http://assets.gfycat.com/img/pause.png";
            ao.src = "http://assets.gfycat.com/img/faster.png";
            V.src = "http://assets.gfycat.com/img/slower.png";
            ao.onclick = aQ;
            V.onclick = ax
        } else {
            au.pause();
            this.src = "http://assets.gfycat.com/img/play.png";
            ao.src = "http://assets.gfycat.com/img/stepforward.png";
            V.src = "http://assets.gfycat.com/img/stepbackward.png";
            ao.onclick = aw;
            V.onclick = a
        }
    }

    function p() {
        var aU = this.parentNode.parentNode.parentNode;
        var aR = aU.getElementsByTagName("video")[0];
        var aT = -0.125;
        aR.pause();
        aR.setAttribute("data-playbackRate", setInterval((function aS() {
            aR.currentTime += aT;
            if (aR.currentTime <= 0.126) {
                aR.currentTime = aR.duration
            }
            return aS
        })(), 125))
    }

    function g() {
        aK.src = "http://assets.gfycat.com/img/pause.png";
        ao.src = "http://assets.gfycat.com/img/faster.png";
        V.src = "http://assets.gfycat.com/img/slower.png";
        ao.onclick = aQ;
        V.onclick = ax;
        au.pause();
        var aR = B("mp4source", au)[0];
        var aS = B("webmsource", au)[0];
        if (ah) {
            aR.src = aR.src.replace(/-reverse\.mp4/g, ".mp4");
            aS.src = aS.src.replace(/-reverse\.webm/g, ".webm");
            ah = false
        } else {
            aR.src = aR.src.replace(/-android/g, "");
            aR.src = aR.src.replace(/\.mp4/g, "-reverse.mp4");
            aS.src = aS.src.replace(/\.webm/g, "-reverse.webm");
            ah = true
        }
        au.playbackRate = 1;
        au.load();
        au.play();
        az.drawLoadingBeat()
    }

    function J(aR) {
        if (au.networkState == HTMLMediaElement.NETWORK_NO_SOURCE) {
            ap.style.backgroundColor = "rgb(242,222,222)";
            ap.style.borderColor = "rgb(238,211,215)";
            ap.style.borderStyle = "solid";
            ap.style.borderWidth = "1px";
            ap.style.padding = "10px";
            ap.style.color = "rgb(185, 74, 72)";
            ap.innerHTML = "Oops! We can't reach this gfy. Is your <b>network</b> working? <br><br>We'd love to here from you if there is a problem on our end.  Sorry!<br><br>You can try directly <a href='" + gfyGifUrl + "'>here</a>."
        }
    }

    function ax() {
        if (au.playbackRate <= 1) {
            au.playbackRate = au.playbackRate / 2
        } else {
            au.playbackRate--
        }
    }

    function aQ() {
        if (au.playbackRate <= 1) {
            au.playbackRate = au.playbackRate * 2
        } else {
            au.playbackRate++
        }
    }

    function aw() {
        if (window.opera) {
            var aR = au.onplay;
            au.onplay = function () {
                au.pause();
                au.onplay = aR
            };
            au.play()
        } else {
            au.currentTime += (1 / gfyFrameRate)
        }
    }

    function a() {
        au.currentTime -= (1 / gfyFrameRate)
    }

    function L() {
        if (au.playbackRate <= 1) {
            var aS = au.playbackRate / 2;
            var aU = au.playbackRate * 2
        } else {
            var aS = au.playbackRate - 1;
            var aU = au.playbackRate + 1
        }
        var aR = "#";
        if (ah) {
            aR = aR + "?direction=reverse";
            var aT = "&"
        } else {
            var aT = "?"
        }
        if (au.playbackRate != 1) {
            aR = aR + aT + "speed=" + au.playbackRate
        }
        V.parentNode.href = aR;
        ao.parentNode.href = aR;
        ctrlReverse.parentNode.href = aR
    }

    function l() {
        if (H) {
            return false
        } else {
            H = true;
            clearTimeout(S);
            S = setTimeout(function () {
                az.showCtrlStep()
            }, 5)
        }
    }

    function N() {
        if (H) {
            return false
        } else {
            H = true;
            clearTimeout(S);
            S = setTimeout(function () {
                az.hideCtrlStep()
            }, 5)
        }
    }

    this.showOpacityStep = function () {
        q = true;
        aF = false;
        if (P) {
            i.style.opacity = parseFloat(i.style.opacity) + 0.1
        }
        if (!aq && D) {
            b.style.opacity = parseFloat(b.style.opacity) + 0.1
        }
        if ((b.style.opacity >= 1 && i.style.opacity >= 1) || (P && !D && i.style.opacity >= 1) || (!P && D && b.style.opacity >= 1)) {
            if (D) {
                b.style.opacity = 1
            }
            if (P) {
                i.style.opacity = 1
            }
            q = false
        } else {
            clearTimeout(u);
            u = setTimeout(function () {
                az.showOpacityStep()
            }, 5)
        }
    };
    this.hideOpacityStep = function () {
        aF = true;
        q = false;
        if (P) {
            i.style.opacity = parseFloat(i.style.opacity) - 0.005
        }
        if (!aq) {
            b.style.opacity = parseFloat(b.style.opacity) - 0.005
        }
        if ((b.style.opacity <= 0 && i.style.opacity <= 0) || (P && !D && i.style.opacity <= 0) || (!P && D && b.style.opacity <= 0)) {
            if (P) {
                i.style.opacity = 0
            }
            b.style.opacity = 0;
            aF = false
        } else {
            clearTimeout(u);
            u = setTimeout(function () {
                az.hideOpacityStep()
            }, 5)
        }
    };
    this.showCtrlStep = function () {
        H = true;
        curBottom = parseInt(i.style.bottom);
        if (isNaN(curBottom)) {
            curBottom = at
        }
        if (curBottom > at - parseInt(i.style.height)) {
            curBottom = curBottom - 4;
            if (curBottom < at - parseInt(i.style.height)) {
                curBottom = at - parseInt(i.style.height)
            }
            i.style.bottom = curBottom + "px";
            clearTimeout(S);
            S = setTimeout(function () {
                az.showCtrlStep()
            }, 5)
        } else {
            H = false
        }
    };
    this.hideCtrlStep = function () {
        H = true;
        curBottom = parseInt(i.style.bottom);
        if (curBottom < at) {
            curBottom = curBottom + 4;
            if (curBottom > at) {
                curBottom = at
            }
            i.style.bottom = curBottom + "px";
            clearTimeout(S);
            S = setTimeout(function () {
                az.hideCtrlStep()
            }, 5)
        } else {
            H = false
        }
    };
    function aB() {
        Y();
        au.load();
        var aR = navigator.userAgent.toLowerCase();
        if (aR.indexOf("android") > -1) {
            au.loop = false;
            au.addEventListener("load", function () {
                au.play()
            }, false);
            au.addEventListener("ended", function () {
                au.currentTime = 0.1;
                au.play()
            }, false)
        }
        au.play();
        ai = 0;
        if (!aq) {
            az.drawLoadingBeat()
        }
    }

    function ad() {
        return;
        var aR = s("speed");
        var aS = s("direction");
        if (aR) {
            au.playbackRate = aR
        }
        if (aS && aS == "reverse") {
            if (!ah) {
                g()
            }
        }
    }

    function s(aY) {
        var aX = window.document.URL.toString();
        if (aX.indexOf("?") > 0) {
            var aT = aX.split("?");
            var aW = aT[1].split("&");
            var aR = new Array(aW.length);
            var aU = new Array(aW.length);
            var aV = 0;
            for (aV = 0; aV < aW.length; aV++) {
                var aS = aW[aV].split("=");
                aR[aV] = aS[0];
                if (aS[1] != "") {
                    aU[aV] = unescape(aS[1])
                } else {
                    aU[aV] = "No Value"
                }
            }
            for (aV = 0; aV < aW.length; aV++) {
                if (aR[aV] == aY) {
                    return aU[aV]
                }
            }
            return 0
        }
    }

    this.drawLoadingBeat = function () {
        aq = 1;
        var a7 = au.buffered;
        var bc = au.duration;
        var aR = 0;
        try {
            var aY = a7.start(0);
            var aV = a7.end(0);
            var aR = aV / bc;
            var a6 = b.getContext("2d");
            a6.clearRect(0, 0, 50, 50);
            a6.beginPath();
            a6.fillStyle = "#555555";
            a6.arc(16, 16, 14, 0, Math.PI * 2, false);
            a6.lineTo(16, 16);
            a6.closePath();
            a6.fill();
            a6.beginPath();
            a6.fillStyle = E;
            a6.arc(16, 16, 15, 0, Math.PI * aR * 2, false);
            a6.lineTo(16, 16);
            a6.closePath();
            a6.fill()
        } catch (ba) {
            try {
                var a6 = t.getContext("2d");
                var a4 = t.width;
                var a0 = t.height;
                a6.clearRect(0, 0, a4, a0);
                a6.beginPath();
                a6.fillStyle = "#333";
                var aW = Math.min(a4, a0) / 2;
                var a5 = a6.createRadialGradient(a4 / 2, a0 / 2, 0, a4 / 2, a0 / 2, aW);
                a5.addColorStop(0, "#ddd");
                a5.addColorStop(1, "#fff");
                aW = Math.max(a4, a0);
                var a9 = 3 * Math.PI / 2 + ((2 * Math.PI * ai) / 10) % (2 * Math.PI);
                a6.arc(a4 / 2, a0 / 2, aW, 3 * Math.PI / 2, a9, false);
                a6.lineTo(a4 / 2, a0 / 2);
                a6.closePath();
                a6.fillStyle = "#888";
                a6.strokeStyle = "#111";
                a6.lineWidth = 4;
                a6.stroke();
                a6.fill();
                a6.beginPath();
                aW = Math.min(a4, a0) * 6 / 16;
                a6.arc(a4 / 2, a0 / 2, aW, 0, 2 * Math.PI, false);
                a6.strokeStyle = "#ccc";
                a6.stroke();
                a6.beginPath();
                aW = Math.min(a4, a0) * 7 / 16;
                a6.arc(a4 / 2, a0 / 2, aW, 0, 2 * Math.PI, false);
                a6.strokeStyle = "#ccc";
                a6.stroke();
                a6.lineWidth = 2;
                a6.strokeStyle = "#111";
                a6.beginPath();
                a6.moveTo(0, a0 / 2);
                a6.lineTo(a4, a0 / 2);
                a6.stroke();
                a6.beginPath();
                a6.moveTo(a4 / 2, 0);
                a6.lineTo(a4 / 2, a0);
                a6.stroke();
                a6.font = a0 / 2 + "px Arial";
                a6.fillStyle = "#111";
                a6.fillText(parseInt(ai / 10) + 1, a4 / 2 - a0 / 8, 3 / 4 * a0);
                ai++;
                var aT = new Array();
                var aS = new Array();
                for (var a8 = 0; a8 < a4 / 4; a8++) {
                    aT.x = ((ai) * 5 + a8) % a4;
                    aT.y = a0 / 8 * Math.sin(aT.x * 8 * Math.PI / a4);
                    aS.x = a4 - aT.x;
                    aS.y = a0 / 8 * Math.sin(aS.x * 8 * Math.PI / a4 + Math.PI)
                }
                t.style.webkitFilter = "blur(2px)";
                i.style.display = "none";
                a6 = b.getContext("2d");
                a6.clearRect(0, 0, 50, 50);
                a6.beginPath();
                var aX = ai * 15 % 125;
                var bb = aX + dotRed;
                var aU = aX + dotGreen;
                var aZ = aX + dotBlue;
                a6.fillStyle = "rgb(" + bb + "," + aU + "," + aZ + ")";
                a6.arc(25, 5, 5, 0, Math.PI * 2, false);
                a6.lineTo(25, 5);
                a6.closePath();
                a6.fill()
            } catch (ba) {
            }
        }
        if (!(aR >= 0.98)) {
            setTimeout(function () {
                az.drawLoadingBeat()
            }, 100)
        } else {
            try {
                ai = 0;
                aq = 0;
                if (P) {
                    i.style.display = "block"
                }
                t.getContext("2d").clearRect(0, 0, t.width, t.height);
                var a6 = b.getContext("2d");
                a6.clearRect(0, 0, 50, 50);
                a6.beginPath();
                a6.fillStyle = E;
                a6.arc(25, 5, 5, 0, Math.PI * aR * 2, false);
                a6.lineTo(25, 5);
                a6.closePath();
                a6.fill();
                setTimeout(function () {
                    az.checkGfyExtras()
                }, 1000);
                ad()
            } catch (ba) {
            }
        }
    };
    function ae() {
        try {
            t.getContext("2d").clearRect(0, 0, t.width, t.height);
            var aR = b.getContext("2d");
            aR.clearRect(0, 0, 50, 50);
            aR.beginPath();
            aR.fillStyle = E;
            aR.arc(25, 5, 5, 0, Math.PI * 2, false);
            aR.lineTo(25, 5);
            aR.closePath();
            aR.fill()
        } catch (aS) {
        }
    }

    return {init: ak, refresh: aB, setGfyItem: c}
};
var gfyCounter = function () {
    var a;

    function b() {
        var e = document.URL;
        var d = /.*\/(.*)/;
        m = d.exec(document.URL);
        a = m[1];
        return a
    }

    function c() {
        b();
        if (a == "account") {
            return
        }
        var d = document.createElement("SCRIPT");
        d.src = "http://tracking.gfycat.com/viewCount/" + a;
        document.getElementsByTagName("HEAD")[0].appendChild(d)
    }

    return {getId: b, callCounter: c}
}();
function jsonpResp(a) {
}
window.onload = function () {
    gfyCollection.init()
};
var loadJSONP = (function () {
    var a = 0;
    return function (d, f, e) {
        var c = "_jsonp_" + a++;
        if (d.match(/\?/)) {
            d += "&callback=" + c
        } else {
            d += "?callback=" + c
        }
        var b = document.createElement("script");
        b.type = "text/javascript";
        b.src = d;
        window[c] = function (g) {
            f.call((e || window), g);
            document.getElementsByTagName("head")[0].removeChild(b);
            b = null;
            delete window[c]
        };
        document.getElementsByTagName("head")[0].appendChild(b)
    }
})();