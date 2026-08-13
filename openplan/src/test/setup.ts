import '@testing-library/jest-dom'
import { installJsdomDialogShim } from './guided-flow-jsdom-dialog-shim'

// jsdom has no `<dialog>` methods at all. See the shim's header for what it
// models and — more importantly — what no test using it may claim.
installJsdomDialogShim()
