# Opportunity Inbox audit — 26 October 2026

The audit used the deployed inbox's actual cards, a full live search preview, official source pages, automated regression tests, and checks of the deployed database permissions.

## Problems found and changes

| Problem observed | Change |
| --- | --- |
| A certificate post was classified as an internship because it said completion did not guarantee an internship. | Classification starts with the opportunity's title. Generic certificate courses and unverified social registrations are withheld. |
| A familiar official domain made a search snippet look verified. | Open the current official page before delivering its facts. Record whether verification came from a page, official feed, or search snippet. |
| Menus, speaker biographies, other programme cards, and website chatbots affected descriptions and eligibility. | Read the relevant page content with a lightweight streaming HTML parser and exclude unrelated content. |
| Several festival pages became separate suggestions, including commercial package and agenda pages. | Compare a stable event identity across runs and exclude sales, agenda, About, news, and sponsorship pages. |
| Some membership fees and multi-day end dates were missing. | Keep known price tiers, VAT wording, and event end dates. Mark conflicting organizer dates for confirmation instead of assigning one. |
| Only the first five new matches were retained. | Store up to fifty suitable matches, deliver up to five per run, and recheck queued official opportunities before later delivery. |
| Two workers could run together and overwrite delivery state. | Use an atomic database run claim. Guard candidate updates against a simultaneous Save action. |
| A scheduled HTTP request could be recorded as successful even if the search failed. | Record each search's actual completion, failures, source errors, and delivery counts. Show them with `/health`. |

The 7 AM and 7 PM UAE schedule remains. Manual searches are spaced ten minutes apart. Saved items and Yusuf's application statuses are preserved. Dismissed suggestions stay dismissed. No application, registration, or purchase is automated.

## Checks

- 103 automated tests cover the existing workflows and the newly observed failures.
- Deno checks cover all three production functions, beyond the Node test suite.
- An overlapping live invocation returned `already_running` rather than starting another search.
- Anonymous and ordinary signed-in clients cannot read the run history or claim searches.
- A full live preview with the streaming reader completed; pages returning 403 or 404 were recorded as verification failures.

The first DOM-based reader exceeded the free worker's compute limit during a live preview. It was replaced with the lighter streaming reader before delivery was enabled. No cards were sent by those previews.

## Limits that remain

The scout sees official pages and public search-indexed content. Private, login-only, and unindexed social posts remain outside its coverage. Some websites block automated reads. Those failures are recorded and cannot become verified suggestions. No search can guarantee that every opportunity is found.

The fit score is an internal ranking aid, not a probability or proof of eligibility. Unknown costs, eligibility, or dates remain unknown. Official pages with a known future event but unclear registration are labelled accordingly.
