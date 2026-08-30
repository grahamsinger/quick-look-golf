// Route the current state to the right view renderer.
import { $ } from '../dom.js';
import { state } from '../state.js';
import { renderShots } from './shots.js';
import { renderPutts } from './putts.js';
import { renderPuttsAll } from './puttsAll.js';
import { renderCourse } from './course.js';
import { renderField } from './field.js';
import { updateFreshBar } from './freshness.js';

export function renderView() {
  // the Field view draws the whole tournament, not the loaded player's round
  if (state.view === 'field') { renderField(); updateFreshBar(); return; }
  if (state.puttsAll) {
    // the Course hole zoom handles "All rounds" itself (fetches its own shots)
    if (state.view === 'course' && state.courseHole) renderCourse();
    else if (state.view === 'shots' || state.view === 'course') $('out').innerHTML = '<div class="summary"><span class="meta">Select a single round to see shot-by-shot detail.</span></div>';
    else renderPuttsAll();
  } else {
    ({ shots: renderShots, course: renderCourse }[state.view] || renderPutts)();
  }
  updateFreshBar();
}
