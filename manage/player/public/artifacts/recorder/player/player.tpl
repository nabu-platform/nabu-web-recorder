<template id="event-player">
	<div class="event-player">
		<div class="events" v-show="events.length">
			<div class="session-content" ref="content"></div>
			<div class="session-heatmap" ref="heatmap"></div>
			<iframe ref="iframe"></iframe>
		</div>
		<div class="no-data" v-show="events.length == 0">%{No events captured}</div>
		<div class="player-information">
			<div class="active-event" v-if="activeEvents.length">
				<div v-for="activeEvent in activeEvents">
					<!--show information of all events in the last x time frame -->
					<!--when you select an event, pause the replay, otherwise it might disappear too fast-->
				</div>
			</div>
			<div class="active-event" v-else>No active events</div>
			
			<div class="selected-event" v-if="selectedEvent">
				<!-- You can select an event from active events and view the details here -->
			</div>
			
			<div class="meta" v-if="loadTime">
				<span class="key">Load Time</span>
				<span class="value">{{loadTime}}ms</span>
			</div>
			
			<div class="player" v-show="events.length > 0">
				<span>0s</span>
				<input :value="playOffset" type="range" :min="0" :max="duration" @input="function(event) { skipTo(event.target.value) }"/>
				<span>{{$services.formatter.number(duration / 1000)}} s</span>
				<button @click="restart"><span class="fa fa-backward"></span></button>
				<button @click="resume" v-if="!playing"><span class="fa fa-play"></span></button>
				<button @click="pause" v-if="playing"><span class="fa fa-pause"></span></button>
			</div>
		</div>
	</div>
</template>