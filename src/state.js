// Authoritative, in-memory queue state. The server owns the queue; the host
// page is just the player that renders whatever `nowPlaying` says.
//
// Any mutation fires onChange(), which the server uses to broadcast the full
// state to every connected client. The state is small (a party playlist), so
// broadcasting the whole thing on every change keeps the logic dead simple.

import { randomUUID } from "node:crypto";

export class JukeboxState {
  constructor() {
    this.nowPlaying = null; // current item or null
    this.queue = []; // upcoming items
    this.history = []; // played items (most recent last), capped
    this.onChange = () => {};
  }

  snapshot() {
    return {
      nowPlaying: this.nowPlaying,
      queue: this.queue,
      historyCount: this.history.length,
    };
  }

  _emit() {
    this.onChange(this.snapshot());
  }

  // Promote the next queued song if nothing is playing.
  _promoteIfIdle() {
    if (!this.nowPlaying && this.queue.length > 0) {
      this.nowPlaying = this.queue.shift();
    }
  }

  // Add a moderated/approved song. Returns the created item incl. its position.
  add({ videoId, title, channel, duration, thumbnail, addedBy }) {
    const item = {
      id: randomUUID(),
      videoId,
      title,
      channel: channel || "",
      duration: duration || "",
      thumbnail: thumbnail || null,
      addedBy: (addedBy || "").slice(0, 40),
      addedAt: Date.now(),
    };
    this.queue.push(item);
    this._promoteIfIdle();
    this._emit();
    const position = this.nowPlaying === item ? 0 : this.queue.indexOf(item) + 1;
    return { item, position };
  }

  // Advance to the next song. `finishedVideoId` guards against double-advances
  // from duplicate "ended"/"error" events for the same track.
  advance(finishedVideoId) {
    if (finishedVideoId && this.nowPlaying && this.nowPlaying.videoId !== finishedVideoId) {
      return; // stale event for a track we already moved past
    }
    if (this.nowPlaying) {
      this.history.push(this.nowPlaying);
      if (this.history.length > 100) this.history.shift();
    }
    this.nowPlaying = this.queue.shift() || null;
    this._emit();
  }

  // Host control: skip the current track regardless of what's playing.
  skip() {
    this.advance(this.nowPlaying?.videoId);
  }

  // Remove an upcoming item by id (host control).
  remove(id) {
    const before = this.queue.length;
    this.queue = this.queue.filter((s) => s.id !== id);
    if (this.queue.length !== before) this._emit();
  }

  // Move an upcoming item up/down (host control).
  move(id, dir) {
    const i = this.queue.findIndex((s) => s.id === id);
    if (i === -1) return;
    const j = dir === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= this.queue.length) return;
    [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    this._emit();
  }
}
