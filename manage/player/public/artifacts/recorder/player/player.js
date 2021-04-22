Vue.component("event-player-single", {
	template: "#event-player-single",
	props: {
		event: {
			type: Object,
			required: true
		}
	}
});

Vue.view("event-player", {
	props: {
		sessionId: {
			type: String,
			required: true
		}
	},
	// it can be slow to load for bigger sessions
	slow: true,
	data: function() {
		return {
			// all the events (backend format)
			events: [],
			regularEvents: [],
			// all the events related to the recorder (backend format)
			recordingEvents: [],
			// all the frontend events
			story: [],
			// any active events currently in the window
			activeEvents: [],
			selectedEvent: null,
			// where are you in the playback right now? offset is in ms
			// maybe we can pass this in as a parameter as well? you can send links like youtube -> at a certain time in the session
			playOffset: 0,
			duration: 0,
			loadTime: 0,
			// the start time of the recording (measured in the frontend)
			recordOffset: 0,
			// the screenshots by hash
			screenshots: {},
			// the current hash visible
			currentHash: null,
			// whether or not we are playing
			playing: false,
			// the timer setting off the next bit
			playTimer: null,
			// the time until the next actual event
			// our timer may be set shorter because we want to move the playOffset
			timeUntilNext: 0,
			iframeWindow: null,
			cursor: null,
			heatmap: null
		}
	},
	computed: {
		userAgent: function() {
			var event = this.events.filter(function(x) {
				return x.userAgent != null;
			})[0];
			return event ? event.userAgent : null;
		},
		alias: function() {
			var event = this.events.filter(function(x) {
				return x.alias != null;
			})[0];
			return event ? event.alias : null;
		},
		eventsBefore: function() {
			var active = this.playOffset == 0 ? this.story[0] : this.getStoryAt(this.playOffset);
			if (!active && this.story.length) {
				active = this.story[this.story.length - 1];
			}
			// if our playoffset is 0, we want pretty much all the events before it
			// otherwise, our current window is 3 seconds
			var window = this.playOffset == 0 ? 60000 : 2000;
			var events = !active ? [] : this.regularEvents.filter(function(x) { return x.created.getTime() <= active.created.getTime() && x.created.getTime() >= active.created.getTime() - window });
			events.forEach(function(x) {
				x.offset = active.created.getTime() - x.created.getTime();
			});
			return events;
		},
		eventsAfter: function() {
			var active = this.playOffset == 0 ? this.story[0] : this.getStoryAt(this.playOffset);
			if (!active && this.story.length) {
				active = this.story[this.story.length - 1];
			}
			// if our playoffset is 0, we want pretty much all the events before it
			// otherwise, our current window is 3 seconds
			var window = 2000;
			var events = !active ? [] : this.regularEvents.filter(function(x) { return x.created.getTime() >= active.created.getTime() && x.created.getTime() <= active.created.getTime() + window });
			events.forEach(function(x) {
				x.offset = active.created.getTime() - x.created.getTime();
			});
			return events;
		}
	},
	activate: function(done) {
		var self = this;
		// load the events of this session
		this.$services.swagger.execute("nabu.web.recorder.manage.rest.session.event.list", {sessionId: this.sessionId}).then(function(result) {
			if (result.results) {
				nabu.utils.arrays.merge(self.events, result.results);
				self.analyze();
			}
			done();
		}, done);
	},
	// ref needs to be available!
	ready: function() {
		this.loadHash(null);
	},
	methods: {
		// analyze the data event data
		analyze: function() {
			var self = this;
			this.story.splice(0);
			this.recordingEvents.splice(0);
			this.regularEvents.splice(0);
			// reset screenshots
			Vue.set(this, "screenshots", {});
			if (this.events.length) {
				nabu.utils.arrays.merge(this.recordingEvents, this.events.filter(function(x) { return x.eventCategory == "record" }));
				nabu.utils.arrays.merge(this.regularEvents, this.events.filter(function(x) { return x.eventCategory != "record" }));
				if (this.recordingEvents.length > 0) {
					// we create  hash map of all the available screenshots
					this.recordingEvents.filter(function(x) { return x.eventName == "screenshot" }).forEach(function(x) {
						var additional = JSON.parse(x.additional);
						var content = JSON.parse(additional.content);
						content.eventId = x.id;
						content.sessionId = x.sessionId;
						self.screenshots[content.hash] = content;
					});
					
					var firstAdditional = JSON.parse(this.recordingEvents[0].additional);
					var lastAdditional = JSON.parse(this.recordingEvents[this.recordingEvents.length - 1].additional);
					
					var started = new Date(firstAdditional.timestamp);
					var stopped = new Date(lastAdditional.timestamp);
					
					var offset = 0;
					
					this.recordingEvents.filter(function(x) { return x.eventName == "event-batch" }).forEach(function(x) {
						var additional = JSON.parse(x.additional);
						// the timestamp of the event batch as measured from the frontend
						// this should more or less match the last event in the batch
						// based on the timestamp of the event which should be closely matched (given some network delays) with the backend-based created timestamp
						// we can extrapolate approximately the server-based timestamp of a frontend based event
						// this server timestamp can then be used to see what else is going on around that time
						var eventTimestamp = new Date(additional.timestamp);
						// an array of frontend events
						var content = JSON.parse(additional.content);
						if (content instanceof Array) {
							// we inject the offset to the start
							content.forEach(function(y) {
								var singleTimestamp = new Date(y.timestamp);
								var offset = eventTimestamp.getTime() - singleTimestamp.getTime();
								// the appromixate server-created timestamp
								y.created = new Date(x.created.getTime() - offset);
							});
							nabu.utils.arrays.merge(self.story, content);
						}
						else {
							console.log("unknown content", content);
						}
					});
					
					// once we have the whole story, insert the offset to the beginning
					this.story.forEach(function(x) {
						x.offset = x.timestamp - self.story[0].timestamp;
					});
					
					// for replay only the frontend timestamp is "relevant" because events are batched
					// however, for sorting, the server side timestamp is the most relevant, the events should already be sorted that way
					// the session start (and stop) only have server side timestamps and are less relevant
					// if we base the timeline on the frontend-timestamps, we could only use the actual session recording events
					// if we base the timeline on the backend-timestamps we can fit everything into the replay, including e.g. initial waits
					
					// the duration is currently based on server timestamps
					//this.duration = this.events[this.events.length - 1].created.getTime() - this.events[0].created.getTime();
					this.duration = stopped - started;
					// we presumably immediately send a screenshot...
					this.loadTime = this.recordingEvents[0].created.getTime() - this.events[0].created.getTime();
					
					//console.log("analyzed", this.duration, this.events, this.story);
				}
			}
		},
		restart: function() {
			this.play(0);
		},
		pause: function() {
			this.playing = false;
			if (this.playTimer != null) {
				clearTimeout(this.playTimer);
				this.playTimer = null;
			}	
		},
		// skip to a particular offset
		skipTo: function(value) {
			// if already playing, restart somewhere
			if (this.playing) {
				this.play(parseInt(value));
			}
			else {
				// otherwise, we just manipulate the play offset for when you resume
				this.playOffset = parseInt(value);
			}
		},
		resume: function() {
			this.play(this.playOffset);	
		},
		// play from a specific offset, assumed to be in time (not an index)
		play: function(offset) {
			if (this.playing) {
				this.pause();
			}
			// reset the screenshot
			this.currentHash = null;
			this.playOffset = offset;
			var active = !offset ? this.story[0] : this.getStoryAt(offset);
			console.log("story at offset", offset, active, this.story);
			if (active) {
				this.playing = true;
				this.playStoryItem(active);
			}
			else {
				this.playing = false;
			}
		},
		// play a single story item
		playStoryItem: function(storyItem) {
			var self = this;
			if (this.playTimer) {
				clearTimeout(this.playTimer);
				this.playTimer = null;
			}
			if (this.playing) {
				var diff = storyItem.offset - this.playOffset;
				// if we want to play it immediately, do so
				if (diff <= 0) {
					this.playStoryItemImmediately(storyItem);
				}
				else {
					var tillNextSecond = 1000 - (this.playTimer % 1000);
					// sleep for max 1 second, we want to move 
					var sleep = Math.min(tillNextSecond, diff);
					this.playTimer = setTimeout(function() {
						self.playOffset += sleep;
						// might sleep again!
						self.playStoryItem(storyItem);
					}, sleep);
				}
			}
		},
		playStoryItemImmediately: function(storyItem) {
			var self = this;
			// make sure we have the correct hash loaded
			if (this.currentHash != storyItem.hash) {
				// loading the hash may take a while, to prevent the playback from continuing, wait for it
				this.loadHash(storyItem.hash, function() {
					self.playStoryItemImmediately(storyItem);
				});
			}
			else {
				if (storyItem.type == "render") {
					this.iframeWindow.scrollTo(storyItem.content.x, storyItem.content.y);
				}
				else if (storyItem.type == "scroll") {
					this.iframeWindow.scrollTo(storyItem.content.x, storyItem.content.y);
				}
				else if (storyItem.type == "move") {
					var cursor = this.getCursor();
					// no need to offset it to the absolute root as it the parent is relative
					cursor.style.left = storyItem.content.x + "px";
					cursor.style.top = storyItem.content.y + "px";
					var data = {
						x: storyItem.content.x,
						y: storyItem.content.y,
						value: 50
					};
					if (this.heatmap != null) {
						this.heatmap.addData(data);
					}
				}
				else if (storyItem.type == "click") {
					var img = this.iframeWindow.document.createElement("img");
					// only clicks on id fields get the special ripple!
					var isTargetted = storyItem.target == null || storyItem.target.substring(0, 1) != "#";
					img.src = isTargetted ? "${server.root()}resources/recorder/ripple3.gif" : "${server.root()}resources/web/analysis/session/ripple2.gif";
					var x = storyItem.content.mouseX == null ? storyItem.content.x : storyItem.content.mouseX;
					var y = storyItem.content.mouseY == null ? storyItem.content.y : storyItem.content.mouseY;
					// ripple2 is 128x128, ripple3 is 192x192
					img.style = "position:absolute;top:" + (y - (isTargetted ? 64 : 96)) + "px;left:" + (x - (isTargetted ? 64 : 96)) + "px;z-index:105";
					img.class = "nabu-session-ripple";
					this.iframeWindow.document.body.appendChild(img);
					setTimeout(function() {
						self.iframeWindow.document.body.removeChild(img);
					}, 500);
				}
				// we want to play the next story item
				var index = this.story.indexOf(storyItem);
				if (index < this.story.length - 1) {
					this.playStoryItem(this.story[index + 1]);
				}
				// not playing anymore
				else {
					this.playing = false;
					// jump back to beginning if we hit play again
					this.playOffset = 0;
				}
			}
		},
		loadHash: function(newValue, handler) {
			var self = this;
			var html;
			var width = 300;
			var height = 100;
			var sessionId = null;
			var eventId = null;
			if (Object.keys(this.screenshots).length == 0) {
				html = "<html><body>No screenshots available for this recording</body></html>";
			}
			else if (newValue == null || newValue == "empty") {
				html = "<html><body>No screenshot available yet</body></html>";
			}
			else if (!this.screenshots[newValue]) {
				html = "<html><body>Screenshot not found</body></html>";
			}
			else {
				html = this.screenshots[newValue].html;
				width = this.screenshots[newValue].viewX;
				height = this.screenshots[newValue].viewY;
				sessionId = this.screenshots[newValue].sessionId;
				eventId = this.screenshots[newValue].eventId;
			}
			this.currentHash = newValue;
			var iframe = this.$refs.iframe;
			// set a handler (or unset it if left empty)
			this.$refs.iframe.onload = function() {
				
				self.iframeWindow = iframe.contentWindow;
				// need to create a new cursor
				self.cursor = null;
				
				// causes heavy flickering because the rest of the code continues and the css is loaded afterwards
				//self.iframeWindow.document.documentElement.innerHTML = html;

				// make sure we can position against it
				iframe.contentWindow.document.body.style.position = "relative";
				
				iframe.contentWindow.document.documentElement.style.width = width + "px";
				iframe.contentWindow.document.documentElement.style.height = height + "px";
				
				// we need to explicitly set the width & height, otherwise the canvas does not scale well (probably takes these two properties?)
				// and if the canvas is not big enough, the heatmapping will throw exceptions
				iframe.contentWindow.document.body.width = iframe.contentWindow.document.body.offsetWidth + "px";
				iframe.contentWindow.document.body.height = iframe.contentWindow.document.body.offsetHeight + "px";
				//iframe.contentWindow.document.body.width = content.bodyWidth + "px";
				//iframe.contentWindow.document.body.height = content.bodyHeight + "px";
				self.heatmap = h337.create({container: iframe.contentWindow.document.body});
				self.heatmap.setDataMax(100);
				
				var canvas = self.heatmap._renderer.canvas;
				canvas.style.width = iframe.contentWindow.document.body.offsetWidth + "px";
				canvas.style.height = iframe.contentWindow.document.body.offsetHeight + "px";
				canvas.style.zIndex = 101;
				
				if (handler) {
					handler();
				}
			}
			//this.$refs.iframe.src = "data:text/html;charset=utf-8," + escape(html);

			// this will load an empty page, then we start twiddling the html itself
			// the problem is that the onload event is triggered once the empty content is loaded, that causes heavy flickering cause the css is only loaded later once the content is set
			// this in turn means the content looks like crap while the player continues until the css kicks in
			//this.$refs.iframe.src = window.location.protocol + "//" + window.location.host + "${server.root()}emptyRecorder";
			
			if (eventId == null) {
				this.$refs.iframe.src = window.location.protocol + "//" + window.location.host + "${server.root()}emptyRecorder";
			}
			else {
				this.$refs.iframe.src = window.location.protocol + "//" + window.location.host + "${server.root()}session/" + sessionId + "/screenshot/" + eventId;
			}
			
			this.$refs.iframe.setAttribute("width", width + "px");
			this.$refs.iframe.setAttribute("height", height + "px");
		},
		getStoryAt: function(offset) {
			var self = this;
			// we are looking for the first event on or after the given offset, as compared to the initial timestamp
			return this.story.filter(function(x) {
				return x.timestamp >= self.story[0].timestamp + offset;
			})[0];
		},
		// get the active screenshot at a certain time
		getScreenshotFor: function(timestamp) {
			return this.recordingEvents.filter(function(x) {
				return x.eventName == "screenshot" && x.timestamp >= timestamp;
			})[0];
		},
		getCursor: function() {
			if (!this.cursor) {
				this.cursor = this.iframeWindow.document.createElement("img");
				this.cursor.src = "${server.root()}resources/recorder/cursor.png";
				this.cursor.style.position = "absolute";
				this.cursor.style.top = "0px";
				this.cursor.style.left = "0px";
				this.cursor.class = "nabu-session-cursor";
				this.cursor.style.zIndex = 102;
				if (this.iframeWindow.document.body) {
					this.iframeWindow.document.body.appendChild(this.cursor);
				}
				else {
					// try again soon!
					setTimeout(function() {
						self.iframeWindow.document.body.appendChild(self.cursor);
					}, 20);
				}
			}
			return this.cursor;
		}
	},
	watch: {
		playing: function(newValue) {
			if (newValue) {
				this.selectedEvent = null;
			}
		}
	}
});