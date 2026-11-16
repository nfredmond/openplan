// Pure helpers both proven-job journeys share for the public engagement
// campaign each one opens: the demonstration label, reading a public page for
// the demonstration's own text, the close at the end and its verdict, the run
// file and the public address file, and the harness checkout a run came from.
// No browser and no server. The first job's journey (first-job-journey.js) and
// the second's (engagement-job-journey.js) call these; the engagement lib
// re-exports them, so its callers are unchanged. Unit-tested in
// first-job-journey.test.js and engagement-job-journey.test.js.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pdfTextHasPhrase } = require('../openplan/scripts/lib/pdf-text-match.mjs');

/**
 * The campaign's title and invitation must say this, in both modes. The first
 * job's campaigns went public under their places' names with no label and had
 * to be taken offline afterward.
 */
const DEMONSTRATION_LABEL = 'Demonstration by an automated OpenPlan proof run';
/** Every comment must say both: who entered it, and that it speaks for no one. */
const COMMENT_STATEMENTS = ['automated proof run', 'represents no one'];

/**
 * The template both journeys make their campaign from, and the opening of the
 * public text that template applies at creation
 * (openplan/src/lib/engagement/campaign-templates.ts). A demonstration must
 * never show it: on the 2026-11-15 dress rehearsal it told residents of the
 * Hopi Reservation that "the project team" would study their comments.
 */
const CAMPAIGN_TEMPLATE = Object.freeze({
  id: 'corridor-safety-study',
  publicSentence: 'We are studying traffic safety in this area',
});

/** The file in a run folder that holds the campaign's public address, and nothing else. */
const PUBLIC_ADDRESS_FILE = 'public-address.txt';
/**
 * A public portal path with a share token in it: /engage/ and then a token's
 * shape (openplan/src/lib/engagement/public-portal.ts mints 28 lowercase
 * letters and digits; 12 or more is read as one, upper case included).
 */
const PUBLIC_PATH_PATTERN = /\/engage\/[A-Za-z0-9]{12,}/;

function squash(value) {
  return String(value).replace(/\s+/g, ' ').trim().toLowerCase();
}

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

/** Whether a text surface holds the string: as typed, HTML-escaped (both apostrophe forms) or JSON-escaped, case and spacing aside. */
function textHolds(haystack, needle) {
  const text = squash(haystack);
  const forms = [needle, escapeHtml(needle), escapeHtml(needle).replace(/&#x27;/g, '&#39;'), JSON.stringify(needle).slice(1, -1)];
  return forms.some((form) => text.includes(squash(form)));
}

function sentencesOf(text) {
  return String(text).replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).filter(Boolean);
}

/**
 * The sentences that show the invitation is on a surface: its first sentence,
 * and its first sentence the campaign title does not also hold. The inputs
 * open the title and the invitation with the same sentence, so the first
 * sentence alone is found on any page that shows the title.
 */
function invitationMarkers(invitation, title) {
  const sentences = sentencesOf(invitation);
  if (!sentences.length) throw new Error('The invitation has no sentence to look for.');
  return {
    firstSentence: sentences[0],
    ownSentence: sentences.find((sentence) => !squash(title).includes(squash(sentence))) || null,
  };
}

/**
 * Refuse a campaign title and invitation that cannot read as a demonstration:
 * each must say DEMONSTRATION_LABEL, and the invitation needs a sentence the
 * title lacks, or a page that shows only the title would pass as showing the
 * invitation. `at` names the fields in the refusal.
 */
function assertDemonstrationCampaign(campaign, at = 'campaign') {
  if (!campaign || typeof campaign !== 'object' || Array.isArray(campaign)) throw new Error(`The inputs file needs ${at} with title and invitation.`);
  for (const field of ['title', 'invitation']) {
    if (typeof campaign[field] !== 'string' || !campaign[field].trim()) throw new Error(`The inputs file needs ${at}.${field}.`);
    if (!campaign[field].toLowerCase().includes(DEMONSTRATION_LABEL.toLowerCase())) {
      throw new Error(`${at}.${field} must say "${DEMONSTRATION_LABEL}", in rehearsal and in proof.`);
    }
  }
  if (!invitationMarkers(campaign.invitation, campaign.title).ownSentence) {
    throw new Error(`${at}.invitation needs a sentence the title does not hold, so a page that shows only the title does not pass as showing the invitation.`);
  }
}

/** Refuse a comment that does not say it was entered by an automated proof run and represents no one. */
function assertCommentStatements(text, at) {
  const lower = String(text).toLowerCase();
  const missing = COMMENT_STATEMENTS.filter((statement) => !lower.includes(statement));
  if (missing.length) throw new Error(`${at} must say it was entered by an automated proof run and represents no one (missing "${missing.join('", "')}").`);
}

/**
 * Read one surface for the demonstration's own text. A page is { name, text,
 * html }: the invitation must be in the text a participant sees, and the
 * template's sentence must be in neither the text nor the HTML (a link
 * preview reads the HTML). A PDF is { name, pages }, read with the shared
 * PDF matcher. Returns the reading with `readsAsDemonstration` and the
 * problems that refuse it.
 */
function readDemonstrationText({ surface, invitation, title, templateSentence = CAMPAIGN_TEMPLATE.publicSentence, createdWith = '', requireInvitation = true }) {
  const markers = invitationMarkers(invitation, title);
  // What the campaign was created with must be gone too, whatever template
  // made it: every sentence of that text the invitation does not also hold.
  const createdWithSentences = sentencesOf(createdWith)
    .filter((sentence) => squash(sentence).length >= 12 && !squash(invitation).includes(squash(sentence)));
  const shown = (phrase) => (surface.pages
    ? surface.pages.some((page) => pdfTextHasPhrase(page, phrase))
    : textHolds(surface.text || '', phrase));
  const anywhere = (phrase) => shown(phrase) || (!surface.pages && textHolds(surface.html || '', phrase));
  const reading = {
    surface: surface.name,
    invitationFirstSentence: markers.firstSentence,
    invitationFirstSentenceFound: shown(markers.firstSentence),
    invitationOwnSentence: markers.ownSentence,
    invitationOwnSentenceFound: markers.ownSentence ? shown(markers.ownSentence) : false,
    templateSentence,
    templateSentenceFound: anywhere(templateSentence),
    createdWithSentencesLookedFor: createdWithSentences.length,
    createdWithSentencesFound: createdWithSentences.filter(anywhere),
    invitationRequired: requireInvitation,
  };
  const problems = [];
  if (requireInvitation) {
    if (!reading.invitationFirstSentenceFound) problems.push(`${surface.name} does not show the invitation's first sentence`);
    if (!markers.ownSentence) problems.push(`the invitation has no sentence the campaign title lacks, so ${surface.name} cannot show that the invitation is there`);
    else if (!reading.invitationOwnSentenceFound) problems.push(`${surface.name} does not show the invitation's sentence "${markers.ownSentence.slice(0, 60)}"`);
  }
  if (reading.templateSentenceFound) problems.push(`${surface.name} shows the template's text "${templateSentence}"`);
  for (const sentence of reading.createdWithSentencesFound) problems.push(`${surface.name} shows text the campaign was created with: "${sentence.slice(0, 60)}"`);
  return { ...reading, readsAsDemonstration: problems.length === 0, problems };
}

/** Refuse unless every reading shows the invitation and none shows the template's text. */
function assertReadsAsDemonstration(readings) {
  if (!readings || readings.length === 0) throw new Error('No surface was read for the demonstration\'s text.');
  const problems = readings.flatMap((reading) => reading.problems);
  if (problems.length) throw new Error(`The campaign does not read as a demonstration: ${problems.join('; ')}.`);
}

// ---------------------------------------------------------------------------
// Closing the campaign at the end
// ---------------------------------------------------------------------------

/**
 * Whether the campaign is closed and offline: the screen's save answered 200
 * with status Closed, every public address read afterward shows the ended
 * notice and none of the campaign's own strings (title, comments), and the
 * public portal data read afterward (`publicRead`, { status,
 * campaignTextFound }) did not answer 200 with those strings (review 59,
 * finding 8).
 */
function closeVerdict({ saveStatus, statusAfter, addresses, publicRead = null, neverPublic = false }) {
  const problems = [];
  if (saveStatus !== 200) problems.push(`the save answered ${saveStatus}`);
  if (statusAfter !== 'closed') problems.push(`the status reads ${statusAfter}`);
  // A journey that stopped before it made a public link has no address to
  // read: the campaign was never public, and closing it is the whole job.
  if (neverPublic) return { closed: problems.length === 0, problems, neverPublic: true };
  if (!addresses || addresses.length === 0) problems.push('no public address was read');
  for (const address of addresses || []) {
    if (!address.endedNoticeShown) problems.push(`${address.name} does not show the ended notice`);
    if (address.campaignTextFound) problems.push(`${address.name} still shows the campaign's own text`);
  }
  if (!publicRead || publicRead.status == null) problems.push('the public portal data was not read after the close');
  else if (publicRead.status === 200 && publicRead.campaignTextFound !== false) problems.push('the public portal data still answers 200 with the campaign\'s own text');
  return { closed: problems.length === 0, problems };
}

/**
 * Run the journey's steps in order, then close what it opened. Steps run until
 * one throws. Whether they all passed or one stopped the run, `close` runs
 * when `campaignId()` names a campaign, so a journey that stops early still
 * takes its campaign offline; the result says whether it tried and whether
 * it worked. `after` steps (the end health readback) run only when every step
 * and the close passed.
 */
async function runJourney({ steps, campaignId, close, after = [] }) {
  let failure = null;
  for (const run of steps) {
    try {
      await run();
    } catch (error) {
      failure = error;
      break;
    }
  }
  const closing = { attempted: false, closed: false, problems: [], error: null };
  if (campaignId()) {
    closing.attempted = true;
    try {
      const verdict = await close();
      closing.closed = verdict.closed === true;
      closing.problems = verdict.problems || [];
    } catch (error) {
      closing.error = error && error.message ? error.message : String(error);
    }
    if (!closing.closed && !failure) {
      failure = Object.assign(new Error(`The campaign was not taken offline: ${closing.error || closing.problems.join('; ')}`), { journeyStep: 'close-campaign' });
    }
  }
  if (!failure) {
    for (const run of after) {
      try {
        await run();
      } catch (error) {
        failure = error;
        break;
      }
    }
  }
  return { failure, close: closing };
}

/**
 * The record's close for one run: what the run file says the close step did
 * and read, and when that step ended. Nothing here is computed; a field the
 * run file does not hold is left out, and the checker refuses the gap.
 */
function closeForRecord(run) {
  const close = run.close || {};
  const reading = close.reading || {};
  const step = (run.steps || []).find((entry) => entry.step === 'close-campaign');
  const publicReadAfter = { status: reading.publicReadStatusAfter ?? null };
  if (typeof reading.publicReadCampaignTextFound === 'boolean') publicReadAfter.campaignTextFound = reading.publicReadCampaignTextFound;
  return {
    attempted: close.attempted === true,
    closed: close.closed === true,
    saveStatus: reading.saveStatus,
    statusAfter: reading.statusAfter,
    addresses: (reading.addresses || []).map(({ name, status, endedNoticeShown, campaignTextFound }) => ({ name, status, endedNoticeShown, campaignTextFound })),
    publicReadAfter,
    endedAt: step ? step.endedAt : undefined,
  };
}

// ---------------------------------------------------------------------------
// The run file and the public address
// ---------------------------------------------------------------------------

/**
 * Write a journey's run file and, in its own file beside it, the campaign's
 * public address. The run files and the record hide the address (its share
 * token is a secret), so the operator could not read the closed page in a
 * fresh session afterward (second job's review). The address file is for
 * that one reading and is deleted after it; it never enters a record.
 *
 * The run file is scrubbed with `scrub` (the journey's secrets) after the
 * token is replaced by `<token>`, and refused if the token or the address is
 * still in it. Returns the paths written.
 */
function writeRunFiles({ outDir, runFileName, result, scrub, origin, portalPath }) {
  const token = portalPath ? String(portalPath).split('/').pop() : null;
  let serialized = JSON.stringify(result, null, 2);
  if (token) serialized = serialized.split(token).join('<token>');
  serialized = scrub(serialized);
  const address = portalPath ? new URL(portalPath, origin).href : null;
  // Any public address left after the replacement (another link the screens
  // showed, or this one in another spelling) refuses the file too.
  const other = serialized.match(PUBLIC_PATH_PATTERN);
  if (other || (token && serialized.toLowerCase().includes(token.toLowerCase()))) {
    throw new Error(`${runFileName} would hold a campaign's public address${other ? ` (${other[0].slice(0, 12)}...)` : ''}; it was not written.`);
  }
  const runFile = path.join(outDir, runFileName);
  fs.writeFileSync(runFile, `${serialized}\n`);
  let addressFile = null;
  if (address) {
    addressFile = path.join(outDir, PUBLIC_ADDRESS_FILE);
    fs.writeFileSync(addressFile, `${address}\n`);
  }
  return { runFile, addressFile };
}

/**
 * The checkout the journey script ran from: `git rev-parse HEAD` and whether
 * any tracked file differs from it (`git status --porcelain
 * --untracked-files=no`). Untracked files are not counted. Throws when git
 * cannot answer: a run must name the harness it ran.
 */
function harnessCheckout(root, run = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) {
  const commit = String(run(['rev-parse', 'HEAD'])).trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`git rev-parse HEAD in ${root} gave "${commit.slice(0, 60)}", not a commit.`);
  const changes = String(run(['status', '--porcelain', '--untracked-files=no'])).trim();
  return { commit, clean: changes === '' };
}

/** SHA-256 of a file's bytes. */
function fileSha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

module.exports = {
  CAMPAIGN_TEMPLATE,
  COMMENT_STATEMENTS,
  DEMONSTRATION_LABEL,
  PUBLIC_ADDRESS_FILE,
  assertCommentStatements,
  assertDemonstrationCampaign,
  assertReadsAsDemonstration,
  closeForRecord,
  closeVerdict,
  fileSha256,
  harnessCheckout,
  invitationMarkers,
  readDemonstrationText,
  runJourney,
  squash,
  textHolds,
  writeRunFiles,
};
