// Route the current state to the right view renderer.
import { $ } from '../dom.js';
import { state } from '../state.js';
import { renderShots } from './shots.js';
import { renderPutts } from './putts.js';
import { renderPuttsAll } from './puttsAll.js';
import { renderCourse } from './course.js';
import { updateFreshBar } from './freshness.js';

export function renderView() {
  if (state.puttsAll) {
    if (state.view === 'shots' || state.view === 'course') $('out').innerHTML = '<div class="summary"><span class="meta">Select a single round to see shot-by-shot detail.</span></div>';
    else renderPuttsAll();
  } else {
    ({ shots: renderShots, course: renderCourse }[state.view] || renderPutts)();
  }
  updateFreshBar();
}
