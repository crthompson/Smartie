# jira-standup aka Smartie

## Setup
1. Clone repo
2. Run `npm install`
3. Run `npm run build`
4. Load unpacked extension from `extension` folder

## Usage
1. Create a JSON file such as `attendees.json` for each team member in the format:
```
[{
    "id": "<JIRA_ID>",
    "name": "<NAME>",
    "avatarUrl": "<URL_FOR_IMAGE>",
    "team": <TEAM_NAME>, //optional
    "excludeFromShuffle": "true/false" //optional
},
... // more team members
]
```
2. Steps for finding team member information for the above JSON:
   - JIRA_ID: Open Jira <https://jira.waystar.com/secure/RapidBoard.jspa?projectKey=XXXX> and click the "QUICK FILTER" associated with that team member.
     - In the URL you'll find `quickFilter=####` this number (####) will be their JIRA_ID
   - URL_FOR_IMAGE: There should also be an image for the team member on the page, (though, this might have to be in the details of the page) so:
     - Right-click the image and choose `open image in new tab`.  Use that new tab's URL as the avatarURL
   - NAME: will just be the name they want to be called in stand up
   - TEAM_NAME: Used to identify two or more team names in a file.  Useful if you manage more than one team. Any value will do as long as its the same across the team
   - EXCLUDEFROMSHUFFLE: If "excludeFromShuffle" is set to "true" for one or more team members, they will load, but always be in the same place order.  Useful if there are those that are called on after the status of the rest.  In this case sort them to the end of the json file.
3. Go to your team's Jira Board
4. Click the Chrome Extension in your browser and in the popup click the "Enabled" checkbox
5. Click the "Import" button and select the JSON file you created above
6. You should now see your team members listed in your Jira board and be able to select them to filter the board down to their work. Right-clicking a team member will change their background color indicating they have a linger to come back to at the end of all team member statuses