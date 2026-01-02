The branch at this point seems like it works, but it's only because of the caching. In reality, changes to the tab state in the background thread need to be propagated back, but this doesn't reliably happen.

Ideas:

- Automatic proxy to send changes back to renderer
- Only allow access of tab state in a callback, and any changes are sent back after callback

Also see the extension debug logs.

# Ugh

This technique is unlikely to work:
- BackgroundProgram's onMessage became async, despite a comment warning against this.
- Structured copy of getTabState removes methods in, e.g., TimeTracker.
