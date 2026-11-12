# Jira standup, aka Smartie

## Setup

1. Clone the repository.
2. Run `npm install`.
3. Run `npm run build`.
4. Load the unpacked extension from the `extension` folder.
5. Open the Smartie popup, select **Manage teams**, and add or import attendees.

## Manage attendees and teams

Use the full-tab manager to add, edit, or remove attendees, assign one or more teams, and map teams to Jira board path substrings. The **Jira account ID** is the stable identity. The **Name** remains the label Smartie matches against Jira Quick and Custom filters. Enter multiple team names separated by semicolons. Avatar URLs are optional; Smartie displays initials if an avatar is missing or fails to load.

Export produces a portable version 1 JSON configuration with attendees and board mappings. The manager also accepts these import formats:

- A bare attendee array.
- A legacy object with `attendees` and optional `boardMappings` properties.
- A version 1 object with `version`, `attendees`, and `boardMappings` properties.

Imports default to merging by exact Jira account ID. Merge updates matching attendees and keeps attendees that exist only in saved configuration. Imported board mappings override saved mappings for the same team, and merge keeps other saved mappings. Replace removes attendees and mappings that are absent from the file, so a file without mappings clears them. Review the preview before saving. Imports reset standup highlights; ordinary manager edits preserve them. **Undo last save** restores the previous configuration.

## Find people in Jira

In **Manage teams**, open **Find people in Jira** and choose an open Waystar Jira board tab. Both discovery paths use that tab's signed-in session, without an API token. Allow Smartie access to `https://waystar.atlassian.net/*`. Refresh the Jira tab after updating the extension, then click **Refresh tabs**. Discovery works with the standup panel disabled.

Choose one of these paths:

- **Search people by name**: Enter at least two characters and click **Search**. Click **Load more** for the next 50 results. Jira searches only the first 1,000 users. Refine your search if someone is missing. Empty results can also indicate missing Browse users permission.
- **Board assignees**: Scrum defaults to **Active sprints only**. Select **Whole board** to include backlog issues. Kanban uses the whole board. Click **Scan board** to read up to 1,000 issues, with only assignee fields requested. **Continue scan** reads the next batch. **Cancel discovery** stops further pages and retains clearly marked partial results. A cancelled or failed scan is not a completed scan.

Select people explicitly, enter an optional common **Target team**, and edit **Smartie Name** for people not in your draft to match the desired Quick or Custom filter label. Smartie keeps Jira full names unless you edit them. Click **Add selected to draft**, then **Save changes** to persist. Existing attendees keep their edited name, avatar, shuffle setting, and team memberships; discovery only adds the target team. The manager's **Cancel** discards unsaved draft changes. Discovery doesn't change board mappings or unrelated draft edits.

## Run standup

1. Open a Jira board at `https://waystar.atlassian.net/jira/software/`.
2. Open the Smartie popup and select **Enabled**.
3. Select **Shuffle** or **Clear** as needed. Right-click an attendee to mark a linger item.

The extension appears only on `https://waystar.atlassian.net/jira/software/*` pages. Team board mappings select a team when the current URL contains the mapped board path. Select **All** in the popup to show every attendee.
