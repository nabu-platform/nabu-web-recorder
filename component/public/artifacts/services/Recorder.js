Vue.service("recorder", {
	services: ["swagger", "user"],
	data: function() {
		return {
			pwa: false,
			hashes: [],
			counter: 1,
			// keeps track of mouse movement
			mouseMovements: [],
			scrolls: [],
			inputs: [],
			// because events are played in sequence, we must keep the batch timeouts low enough
			batchTimeout: 50,
			useHtml: true,
			inlineImages: false,
			inlineCss: false,
			mouseX: 0,
			mouseY: 0,
			cssPromises: [],
			css: "",
			detailed: false,
			bufferedEvents: [],
			bufferedScreenshots: [],
			// we bundle several events in the same timeframe
			// note that we can currently _not_ send a "final batch" on close, the websocket is already closing or closed by the time our exit code gets triggered
			// as a temporary workaround we lowered the batch timeout window, limiting the amount of data we lose
			// alternatives will have to be found...
			batchTimeout: 500,
			// or when a certain amount of items is reached
			batchSize: 500,
			// we batch calls together using this timer
			batchTimer: null,
			host: null
		}
	},
	created: function() {
		// ends with ":"
		// the host also contains the port, if you only want the name, use hostname
		this.host = window.location.protocol + "//" + window.location.host;
	},
	activate: function(done) {
		// non-watched events by name
		this.events = {};
		var self = this;
		// if we are doing server side rendering or its a bot, don't start a session
		if (navigator.userAgent.match(/Nabu-Renderer/) || navigator.userAgent.match(/bot/i)) {
			done();
		}
		else {
			// if triggering a lot of changes, wait until it stabilizes
			var timer = null;
			var config = { attributes: true, childList: true, subtree: true, characterData: true };
			var callback = function(mutationsList, observer) {
				// we don't care about the actual mutations, just toss 'em for memory purposes
				observer.takeRecords();
				if (timer) {
					clearTimeout(timer);
				}
				// give it time to settle down
				timer = setTimeout(function() {
					// we stop observing while we take a screenshot
					observer.disconnect();
					// once the screenshot is done, start observing again
					self.screenshot(function() {
						self.observer.observe(document.body, config);
					});
				}, 100);
			};
			self.observer = new MutationObserver(callback);
			self.observer.observe(document.body, config);
			
			// let's see if you are running in pwa modus or web application modus
			if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
				self.pwa = true;
			}
			// safari
			else if (window.navigator.standalone === true) {
				self.pwa = true;
			}
			else {
				self.pwa = false;
			}
				
			done();

			// load css for the screenshots
			this.loadCss();
		}
	},
	beforeDestroy: function() {
		if (self.observer) {
			self.observer.disconnect();
			self.observer = null;
		}
	},
	methods: {
		// type is e.g. scroll, click, move, type,...
		// the target is the target element (if any)
		// content is a freestyle json object relevant for that type
		fire: function(type, target, content) {
			this.bufferedEvents.push({
				target: target ? this.getIdentifier(target) : null,
				// the hash to render against
				hash: this.lastHash,
				url: window.location.href,
				// resolution
				resX: screen.width,
				resY: screen.height,
				// actual window size available to the DOM
				viewX: window.innerWidth,
				viewY: window.innerHeight,
				type: type,
				// need this for correct delays in replay
				timestamp: new Date().getTime(),
				content: content
			});
			if (this.batchTimer) {
				clearTimeout(this.batchTimer);
				this.batchTimer = null;
			}
			if (this.bufferedEvents.length > this.batchSize) {
				this.fireAll();
			}
			// otherwise we do it after a timeout
			else {
				this.batchTimer = setTimeout(this.fireAll, this.batchTimeout);
			}
		},
		fireAll: function() {
			var toPush = this.bufferedEvents.splice(0);
			if (toPush.length > 0) {
				this.$services.analysis.push({
					category: "recorder",
					type: "record",
					event: "event-batch",
					content: toPush
				});
			}
		},
		loadCss: function() {
			var self = this;
			var links = document.head.getElementsByTagName("link");
			for (var i = 0; i < links.length; i++) {
				if (this.inlineCss) {
					if (links[i].hasAttribute("href")) {
						this.cssPromises.push(nabu.utils.ajax({
							url: links[i].getAttribute("href")
						}).then(function(response) {
							if (response.responseText) {
								self.css += response.responseText;
							}
						}));
					}
				}
				// just keep the links
				else {
					var href = links[i].getAttribute("href");
					if (href) {
						// make it absolute
						if (href.indexOf("/") == 0) {
							href = this.host + href;
						}
						self.css += "<link rel='stylesheet' type='text/css' href='" + href + "'/>";
					}
				}
			}
		},
		getPathTo: function(target) {
			var path = null;
			while (target && target.nodeType == 1 && target.tagName) {
				if (path != null) {
					path += "/";
				}
				else {
					path = "";
				}
				path += target.tagName.toLowerCase();
				var index = this.getElementIndex(target);
				if (index > 1) {
					path += "[" + index + "]";
				}
				target = target.parentNode;
			}
			return path;
		},
		// 1 based cause xpath
		getElementIndex: function(element) {
			var count = 1;
			var tagName = element.tagName;
			while (element) {
				if (element.previousSibling && element.previousSibling.nodeType == 1 && element.previousSibling.tagName == tagName) {
					count++;
				}
				element = element.previousSibling;
			}
		},
		getIdentifier: function(element) {
			var id = element.getAttribute("id");
			if (id) {
				return "#" + id;
			}
			var name = element.getAttribute("name");
			if (name) {
				return "@" + name;
			}
			return this.getPathTo(element);
		},
		close: function() {
			console.log("-----------> closing!", this.bufferedEvents.length);
			if (this.batchTimer) {
				clearTimeout(this.batchTimer);
				this.batchTimer = null;
			}
			// fire whatever is left
			this.fireAll();
		},
		imageUrlToData: function(url, callback) {
			var image = new Image();
			var self = this;
			image.onload = function() {
				callback(self.imageToData(image));
			}
			image.src = url;
		},
		imageToData: function(image) {
			var canvas = document.createElement("canvas");
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;
			canvas.getContext("2d").drawImage(image, 0, 0);
			return canvas.toDataURL('image/png');
		},
		// https://html2canvas.hertzen.com/configuration/
		screenshot: function(done) {
			var self = this;
			if (done == null) {
				done = function() {};
			}
			// innerWidth is _with_ scrollbars (what css uses for media)
			// clientWidth is without scrollbars
			var browseProperties = { x:window.pageXOffset, y: window.pageYOffset, width: window.innerWidth, height: window.innerHeight, bodyWidth: document.documentElement.offsetWidth, bodyHeight: document.documentElement.offsetHeight };//width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
			var html = document.body.innerHTML;
			var div = document.createElement("div");
			div.innerHTML = html;
			
			var promises = [];
			
			var convertImage = null;
			if (this.inlineImages) {
				convertImage = function(img) {
					var promise = self.$services.q.defer();
					promises.push(promise);
					self.imageUrlToData(img.src, function(src) {
						img.src = src;
						promise.resolve();
					});
				}
			}
			else {
				convertImage = function(img) {
					// the src attribute seems completely resolved when asking img.src but not img.getAttribute("src")
					img.setAttribute("src", img.src);
					if (img.src.indexOf("/") == 0) {
						img.src = self.host + img.src;
					}
				}
			}
			
			// inline actual image tags
			var images = div.getElementsByTagName("img");
			for (var i = 0; i < images.length; i++) {
				//images[i].src = this.imageToData(images[i]);
				convertImage(images[i]);
			}
			
			nabu.utils.arrays.merge(promises, this.cssPromises);
			this.$services.q.all(promises).then(function() {
				
				html = div.innerHTML;

				// fun stuff but doesn't take into account media rules
				/*						
				var style = "";
				nabu.utils.elements.cssRules().map(function(rule) {
					var cssText = rule.style.cssText;
					var match = cssText.match(/url\("[^)]*"\)/g);
					if (match) {
						match.map(function(x) {
							if (x.indexOf(".png") >= 0 && x.indexOf("data:") < 0) {
								// TODO: inline css images?
							}
						});
					}
					style += rule.selectorText + "{" + cssText + "}"
				});
				*/
				
				// in an example when inlining css, we ended up with 410kb
				// without inlining css, we ended up with 34kb
				html = "<html><head>" + (self.inlineCss ? "<style>" : "") + self.css + (self.inlineCss ? "</style>" : "") + "</head><body>" + html + "</body></html>";
				
				// there are tons of empty comment placeholders, presumably a vue leftover, this can shave another 10% off the total filesize (in the above 34k not-inlined-css-example)
				html = html.replace(/<!-[-]*->/g, "");
				
				// get hash of everything, including css
				var hash = SparkMD5.hash(html);
			
				console.log("screenshotting", hash, self.hashes.indexOf(hash) < 0);
				// only store the hash if we don't have it already
				if (self.hashes.indexOf(hash) < 0) {
					// we push the entire html as a separate, non-buffered event
					self.$services.analysis.push({
						category: "recorder",
						type: "record",
						event: "screenshot",
						content: {
							hash: hash,
							// resolution
							resX: screen.width,
							resY: screen.height,
							// actual window size available to the DOM
							viewX: window.innerWidth,
							viewY: window.innerHeight,
							html: html
						}
					});
					self.hashes.push(hash);
				}
				// update the hash so it is correctly registered on this event
				self.lastHash = hash;
				// we fire a render in the long list of events that can reference the screenshot
				self.fire("render", null, browseProperties);
				done();
			});
		}
	}
});

// stop the session when unloading
// we want to trigger this before the other event stuff
// for chrome
window.addEventListener("beforeunload", function(event) {
	if (application.services && application.services.recorder) {
		application.services.recorder.close();
	}
}, true);

// for not-chrome
window.addEventListener("unload", function(event) {
	if (application.services && application.services.recorder) {
		application.services.recorder.close();
	}
}, true);

window.addEventListener("mousemove", function(event) {
	if (application.services && application.services.recorder) {
		application.services.recorder.mouseX = event.pageX;
		application.services.recorder.mouseY = event.pageY;
		application.services.recorder.fire("move", null, {x: event.pageX, y: event.pageY});
	}
});

window.addEventListener("mousedown", function(event) {
	if (application.services && application.services.recorder) {
		// for some reason the pageX and pageY of the event are sometimes ... off versus the actual mouse position
		// for instance the last reported mouse position was 800,800 and for some reason the click reports 400,400
		// so in this case we also track the last mouse position and send it along and use that for replay if possible
		// if no id, buffer the event
		//application.services.recorder.fire("click", event.target, {x: event.pageX, y: event.pageY});
		application.services.recorder.fire("click", event.target, {x: application.services.recorder.mouseX, y: application.services.recorder.mouseY});
	}
});

window.addEventListener("scroll", function(event) {
	if (application.services && application.services.recorder) {
		application.services.recorder.fire("scroll", null, {x: event.pageX, y: event.pageY});
	}
});

window.addEventListener("keyup", function(event) {
	if (application.services && application.services.recorder) {
		// capture the value of the target
		// if we just capture the characters you type, we will miss backspace, delete, select all+type etc
		// so we just capture the resulting text
		var value = event.target.value;
		if (value && event.target.hasAttribute("type") && event.target.getAttribute("type") == "password") {
			// we don't want to accidently store passwords, just replace the amount of characters with *
			value = value.replace(/./g, "*");
		}
		application.services.recorder.fire("type", event.target, {value: value});
	}
});

document.addEventListener("visibilitychange", function() {
	// visibility changes can be triggered before the service bus is done initializing
	if (application.services && application.services.recorder) {
		application.services.recorder.fire("visible", null, {visible: document.visibilityState});
	}
});

window.addEventListener("hashchange", function(event) {
	if (application.services && application.services.recorder) {
		application.services.analysis.recorder("browse", null, {to: event.newURL});
	}
});

var $originalPushState = window.history.pushState;
window.history.pushState = function() {
	$originalPushState.apply(window.history, arguments);
	if (application.services && application.services.recorder) {
		var path = window.location.pathname;
		if (window.location.search != null) {
			path += window.location.search;
		}
		if (window.location.hash) {
			path += window.location.hash;
		}
		var serverPath = "${environment('serverPath')}";
		if (path.indexOf(serverPath) == 0) {
			path = path.substring(serverPath.length);
		}
		application.services.recorder.fire("browse", null, {to: path});
	}
};