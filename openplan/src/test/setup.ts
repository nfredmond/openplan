import '@testing-library/jest-dom'
import { configure } from '@testing-library/react'
import { installJsdomDialogShim } from './guided-flow-jsdom-dialog-shim'

// jsdom has no `<dialog>` methods at all. See the shim's header for what it
// models and — more importantly — what no test using it may claim.
installJsdomDialogShim()

// Testing Library's findBy and waitFor give up after one second by default.
// That is a limit on how loaded the CI runner is, not on whether the UI is
// right: invoice-record-composer-award-terms failed on main 4dfa830 (October
// 24) and 7d1a196 (November 2) waiting 1.4 s for text that renders locally in
// milliseconds. Five seconds only lengthens a wait that was going to fail;
// a passing test returns as soon as its element appears.
configure({ asyncUtilTimeout: 5_000 })
