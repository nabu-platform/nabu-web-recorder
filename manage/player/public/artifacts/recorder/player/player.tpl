<template id="event-player">
	<div class="event-player">
		<div class="events" v-show="events.length">
			<div class="session-content" ref="content"></div>
			<div class="session-heatmap" ref="heatmap"></div>
			<iframe ref="iframe"></iframe>
		</div>
		<div class="no-data" v-show="events.length == 0">%{No events captured}</div>
		<div class="player-information">
			
			<div class="player" v-show="events.length > 0">
				<span>0s</span>
				<input :value="playOffset" type="range" :min="0" :max="duration" @input="function(event) { skipTo(event.target.value) }"/>
				<span>{{$services.formatter.number(duration / 1000)}} s</span>
				<button @click="restart"><span class="fa fa-backward"></span></button>
				<button @click="resume" v-if="!playing"><span class="fa fa-play"></span></button>
				<button @click="pause" v-if="playing"><span class="fa fa-pause"></span></button>
			</div>
			
			<div class="metadata">
				<h3>Metadata</h3>
				<div class="meta" v-if="alias">
					<span class="key">User</span>
					<span class="value">{{alias}}</span>
				</div>
				
				<div class="meta" v-if="userAgent">
					<span class="key">User Agent</span>
					<span class="value">{{userAgent}}</span>
				</div>
				
				<div class="meta" v-if="loadTime">
					<span class="key">Load Time</span>
					<span class="value">{{loadTime}}ms</span>
				</div>
				<div class="meta" v-if="playOffset > 0">
					<span class="key">Playback positioned at</span>
					<span class="value">{{$services.formatter.number(playOffset / 1000)}} s</span>
				</div>
			</div>
			
			<div class="active-event" v-if="eventsBefore.length || eventsAfter.length">
				<h3>Events</h3>
				<event-player-single :event="activeEvent" v-for="activeEvent in eventsBefore"/>
				<div class="current-playing">Playback position</div>
				<event-player-single :event="activeEvent" v-for="activeEvent in eventsAfter"/>
			</div>
			
			<div class="selected-event" v-if="selectedEvent">
				<!-- You can select an event from active events and view the details here -->
			</div>
		</div>
	</div>
</template>


<template id="event-player-single">
	<div class="event-player-single" :class="'severity-' + event.severity.toLowerCase()">
		<span class="event-icon" :class="'severity-' + event.severity.toLowerCase()"><img :src="'${server.root()}resources/recorder/' + event.severity.toLowerCase() + '.svg'"/></span>
		<span class="event-category">{{event.eventCategory}}</span>
		<span class="event-name">{{event.eventName}}</span>
		<span class="event-code" v-if="event.responseCode || event.code"><span v-if="event.responseCode">{{event.responseCode}}</span><span v-if="event.responseCode && event.code"> - </span><span v-if="event.code">{{event.code}}</span></span>
		<span class="event-target">
			<span v-if="event.requestUri"><span class="event-method" v-if="event.method">{{event.method}}</span><span class="event-target-value">{{event.requestUri}}</span></span>
			<span v-else-if="event.artifactId" class="event-target-value">{{event.artifactId}}</span>
		</span>
		<span class="event-duration" v-if="event.duration != null">{{event.duration}}ms</span>
	</div>
</template>