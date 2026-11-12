# Smartie Standup privacy policy

Effective date: 2026-11-12

Smartie Standup is a Chrome extension published by Chad Thompson. It adds team management and standup features to Waystar Jira. This policy describes information Smartie uses and where it is stored.

## Information Smartie uses

Smartie uses information you provide or select to run its standup and team management features. This can include attendee names and display labels, Jira account IDs, avatar URLs, team memberships, board mappings, standup flags and order, and extension preferences. When you start discovery, Smartie also uses the selected open Waystar Jira board tab URL, board metadata, and the search text you enter.

When you request person search or board-assignee discovery, Smartie sends requests to Waystar Jira over HTTPS. Board-assignee discovery requests only the assignee field, not issue summaries, descriptions, or comments. Jira responses can contain additional metadata. Smartie selects account IDs, display names, and avatar URLs for discovery and does not save raw issue records or returned email addresses in its configuration.

Smartie uses your existing signed-in Jira browser session for same-origin requests. Your browser sends session credentials as it normally does. Smartie does not ask for, extract, or store your password, API tokens, or authentication cookies.

## Storage and sharing

Smartie saves your roster, mappings, standup state, and preferences in `chrome.storage.local` in your browser profile. Smartie does not operate a backend service or cloud-sync these records. Discovery choices remain an unsaved draft until you select **Save**. Smartie may retain one previous configuration as a restore backup. Older configuration and runtime records from prior versions may also remain in local storage during migration.

If you export your configuration, Smartie creates a JSON file on your device. It contains attendee information and board mappings. Anyone you share that file with can read that information. The exported file is outside Smartie's extension storage, so removing Smartie data does not delete exported files.

Smartie does not use analytics or advertising, sell personal information, or send this information to a developer-operated collection service. It uses the information described here to provide the extension's standup, team management, and user-triggered Jira discovery features.

## Network requests and avatars

Discovery requests go to `https://waystar.atlassian.net` using your browser's signed-in session. Smartie displays avatars using Jira-provided URLs or URLs you configure. Your browser requests those image URLs from their hosts, which receive the usual connection information associated with a browser request. Jira-discovered avatar URLs must use HTTPS. Smartie does not require manually configured avatar URLs to use HTTPS. The browser handles each URL according to its scheme and security policies. Use HTTPS when you need an encrypted connection.

## Retention and deletion

Saving changes updates the active configuration. Removing an attendee does not guarantee that related data is removed from the previous-configuration backup, legacy records, or runtime records. Uninstall Smartie or clear its local extension storage to remove extension-managed local data. Delete exported JSON files separately.

## Security and contact

Smartie stores extension data in your browser's local extension storage and uses HTTPS for its Jira discovery requests. Avatar requests follow the URL scheme configured for each avatar. No storage method or network connection can be guaranteed completely secure.

For privacy questions or to report a change needed in this policy, contact [Chad Thompson](mailto:chad.thompson@waystar.com). This policy should be updated if Smartie's data use or storage changes.
