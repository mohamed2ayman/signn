/// <reference types="office-js" />

/**
 * Ribbon command stub.
 *
 * The "Open SIGN" ribbon button is configured in the manifest as a
 * ShowTaskpane action targeting the taskpane URL — Office handles that
 * directly without invoking JS. This file exists because Office requires
 * a FunctionFile for the commands surface, and so we have a place to
 * register additional ribbon commands later (e.g. "Analyze risks now").
 */

Office.onReady(() => {
  // Reserved for future ribbon function commands.
});

/* eslint-disable @typescript-eslint/no-unused-vars */
function noop(event: Office.AddinCommands.Event) {
  event.completed();
}

// Office.actions is provided at runtime by office.js; expose any future
// function-commands here via Office.actions.associate.
if (typeof Office !== 'undefined' && (Office as any).actions) {
  (Office as any).actions.associate('noop', noop);
}
