import '@testing-library/jest-dom'
import { configure } from '@testing-library/react'
import { installJsdomDialogShim } from './guided-flow-jsdom-dialog-shim'

// jsdom has no `<dialog>` methods at all. See the shim's header for what it
// models and — more importantly — what no test using it may claim.
installJsdomDialogShim()

// Testing Library's findBy and waitFor give up after one second by default.
// Five seconds only lengthens a wait that was going to fail; a passing test
// returns as soon as its element appears. It did not fix the
// invoice-record-composer-award-terms failures of October 24 and November 2,
// which were a stale submit handler in GuidedFlow, not a slow runner.
configure({ asyncUtilTimeout: 5_000 })
