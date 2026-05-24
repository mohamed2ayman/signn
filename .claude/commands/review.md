Review the current branch changes against main. Run this checklist:

1. Run: git diff main --stat — show files changed
2. Run: git diff main — show full diff
3. Check for security issues:
   - Any new password/secret/token handling? Verify it follows CLAUDE.md rules
   - Any new ILIKE patterns? Must use escapeLikeParam()
   - Any new @Body() without DTO validation?
   - Any new file uploads without size/type limits?
   - Any dangerouslySetInnerHTML?
4. Check for Phase 3.2 artifacts (all 5 checks from CLAUDE.md)
5. Check for console.log or debugger statements left in
6. Check for any TODO/FIXME/HACK comments that should be resolved
7. Run backend tests: npm test --prefix backend
8. Report: PASS / FAIL with details for each check
