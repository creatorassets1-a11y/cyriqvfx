/**
 * @apex/edit-engine
 *
 * The platform-agnostic editing core for ApexEdit. Pure TypeScript with no DOM,
 * no native bindings and no I/O — it describes what an edit *is* and what a
 * frame *should look like*, and leaves decoding, rendering and encoding to the
 * host platform.
 *
 * The same engine backs the iOS renderer, the Android renderer and the web
 * reference prototype, which is what guarantees a project looks identical
 * everywhere it opens.
 */

// Time — frame-accurate, integer-tick.
export * from './time/time.js';

// Document model.
export * from './model/types.js';
export * from './model/factory.js';

// Animation.
export * from './animation/bezier.js';
export * from './animation/keyframes.js';

// Retiming.
export * from './speed/speed.js';

// Colour.
export * from './color/grade.js';

// Audio parameters.
export * from './audio/audio.js';

// Effects.
export * from './effects/registry.js';

// Document access and mutation.
export * from './document/queries.js';
export * from './document/mutate.js';

// Editing operations.
export * from './edit/clip-edit.js';
export * from './edit/operations.js';

// History.
export * from './history/history.js';

// Render compilation.
export * from './render/compose.js';
export * from './render/audio-graph.js';
export * from './render/export.js';

// Captions.
export * from './captions/captions.js';

// AI job queue.
export * from './ai/jobs.js';

// Project I/O.
export * from './io/serialize.js';
