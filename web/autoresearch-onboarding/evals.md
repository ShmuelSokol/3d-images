# Onboarding Flow Evals — 3D Image Generator

EVAL 1: Clear Steps
Question: Does the landing page show a clear, numbered step-by-step flow (upload → process → results)?
Pass: 3+ distinct steps with numbers/icons, concise labels, logically ordered. User can understand the full workflow in under 5 seconds.
Fail: No flow diagram, or steps are unclear/wordy/missing

EVAL 2: Visual Demo
Question: Are there real visual examples showing input photo → depth map → 3D output?
Pass: At least one real before/after example with actual processed images visible on the page. User can see what the output looks like before uploading.
Fail: Only text descriptions, no visual examples of actual output

EVAL 3: Mobile Responsive
Question: Does the onboarding flow work well on 375px mobile screens?
Pass: Steps stack vertically on mobile, images scale properly, text is readable, no horizontal overflow
Fail: Steps overflow, images too small, text cut off

EVAL 4: Seamless Integration
Question: Does the flow integrate naturally with the existing page layout?
Pass: Flow appears between header and upload area, matches existing glassmorphism/dark theme, doesn't feel bolted-on. Collapses or hides once user has uploaded their first image.
Fail: Looks like a different site, breaks page flow, or stays visible after user starts using the app

EVAL 5: Call to Action
Question: Does the flow end with a clear CTA that leads to the upload area?
Pass: Final step or button invites user to "Try it now" / "Upload your first photo" and scrolls/focuses to the upload area
Fail: Flow is informational only with no connection to the upload action

EVAL 6: Output Format Showcase
Question: Does the flow show all 6 output formats so users know what they'll get?
Pass: All 6 formats (Anaglyph 3D, Depth Map, Color Map, Magic Eye, Side-by-Side, Original) are shown or mentioned with small visual previews
Fail: Only mentions 1-2 formats or doesn't explain what outputs are available
