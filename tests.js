const test = require("node:test");
const assert = require("node:assert/strict");

function getDisplayPct(accumulated, timeLimitMinutes, snoozeState) {
  if (snoozeState.active && snoozeState.durationSeconds > 0) {
    const snoozeUsed = Math.max(0, accumulated - snoozeState.startAccumulated);
    return snoozeUsed / snoozeState.durationSeconds;
  }
  return accumulated / (timeLimitMinutes * 60);
}

function shouldShowLimitPrompt(currentAccumulated, limitMinutes, isTracking, snoozeState) {
  if (!limitMinutes || !isTracking) return false;

  const limitSeconds = limitMinutes * 60;
  if (currentAccumulated < limitSeconds) return false;

  if (snoozeState.active) {
    const snoozeEndAccumulated = snoozeState.startAccumulated + snoozeState.durationSeconds;
    if (currentAccumulated < snoozeEndAccumulated) return false;
  }

  return true;
}

test("normal progress uses original time limit", () => {
  const pct = getDisplayPct(300, 20, {
    active: false,
    startAccumulated: 0,
    durationSeconds: 0
  });
  assert.equal(pct, 300 / 1200);
});

test("snooze progress uses snoozed usage budget", () => {
  const pct = getDisplayPct(660, 20, {
    active: true,
    startAccumulated: 600,
    durationSeconds: 120
  });
  assert.equal(pct, 0.5);
});

test("prompt hidden while under snooze budget", () => {
  const show = shouldShowLimitPrompt(
    650,
    10,
    true,
    { active: true, startAccumulated: 600, durationSeconds: 120 }
  );
  assert.equal(show, false);
});

test("prompt shown after snooze budget is consumed", () => {
  const show = shouldShowLimitPrompt(
    730,
    10,
    true,
    { active: true, startAccumulated: 600, durationSeconds: 120 }
  );
  assert.equal(show, true);
});

test("prompt not shown when not tracking", () => {
  const show = shouldShowLimitPrompt(
    999,
    10,
    false,
    { active: false, startAccumulated: 0, durationSeconds: 0 }
  );
  assert.equal(show, false);
});
test("snooze progress can exceed 100% after budget is consumed", () => {
  const pct = getDisplayPct(750, 20, {
    active: true,
    startAccumulated: 600,
    durationSeconds: 120
  });
  assert.equal(pct, 150 / 120);
});

test("normal progress handles zero accumulated", () => {
  const pct = getDisplayPct(0, 20, {
    active: false,
    startAccumulated: 0,
    durationSeconds: 0
  });
  assert.equal(pct, 0);
});

test("prompt shown exactly at time limit boundary", () => {
  const show = shouldShowLimitPrompt(
    600, // 10 min exactly
    10,
    true,
    { active: false, startAccumulated: 0, durationSeconds: 0 }
  );
  assert.equal(show, true);
});

test("prompt hidden just below time limit", () => {
  const show = shouldShowLimitPrompt(
    599,
    10,
    true,
    { active: false, startAccumulated: 0, durationSeconds: 0 }
  );
  assert.equal(show, false);
});

test("prompt hidden exactly at snooze end boundary while active logic still compares '< end'", () => {
  const show = shouldShowLimitPrompt(
    720, // start 600 + duration 120
    10,
    true,
    { active: true, startAccumulated: 600, durationSeconds: 120 }
  );
  // In your current logic: current < end hides; current === end shows.
  assert.equal(show, true);
});

test("prompt hidden during snooze even if above original limit", () => {
  const show = shouldShowLimitPrompt(
    680,
    10,
    true,
    { active: true, startAccumulated: 600, durationSeconds: 120 }
  );
  assert.equal(show, false);
});

test("prompt not shown when limitMinutes is null/0", () => {
  const showNull = shouldShowLimitPrompt(
    1000,
    null,
    true,
    { active: false, startAccumulated: 0, durationSeconds: 0 }
  );
  const showZero = shouldShowLimitPrompt(
    1000,
    0,
    true,
    { active: false, startAccumulated: 0, durationSeconds: 0 }
  );
  assert.equal(showNull, false);
  assert.equal(showZero, false);
});

test("prompt not shown when tracking is false even if over limit and snooze expired", () => {
  const show = shouldShowLimitPrompt(
    900,
    10,
    false,
    { active: true, startAccumulated: 600, durationSeconds: 120 }
  );
  assert.equal(show, false);
});
