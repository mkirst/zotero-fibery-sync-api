# Zotero Fibery integration app

This is an integration that synchronizes [Zotero](https://www.zotero.org/) to [Fibery](https://fibery.io/).

## Usage

- In Fibery, navigate to the space where you want to add Zotero
- Click on the "integrate" button on the upper toolbar
- Paste the following URL into the box: [zotero-fibery-sync-api-production.up.railway.app](https://zotero-fibery-sync-api-production.up.railway.app) (or host your own instance of this code and use that URL)
- Follow the configuration menu in Fibery. If you want to be able to read from private Zotero libraries or add items to your library, you will need to use token-based authentication. Otherwise you can use public authentication. You can get a token from the Zotero website (the configuration page has a link).
- You will also need to provide a link to the Zotero ID for the library you wish to sync.
- If the library you are syncing is a group library, check the "group library" box.
- Optionally, you can name this set of configurations, so that if you add multiple configurations you can tell them apart more easily.
- Click through to the next page to configure the databases you want to sync.
- You're done!

## Databases

This integration will create five databases (unless you choose to skip some of them):

- **Literature** (this contains your standard top-level Zotero items, i.e. papers, books, etc.)
- **Authors** (contains people who wrote the things in the Literature database; note that Zotero does not maintain an authors database, so this is literally just extracted from the literature in your database)
- **Venues** (contains places where the things in the Literature database were published; as with authors, Zotero does not maintain a venues database, so this is also just extracted from the literature in your database)
- **Tags** (contains all tags used in your library)
- **Notes** (contains all the notes associated with literature in your library)

## Actions

This integration also gives you access to some actions which you can use to automate stuff related to Zoteto:

- **Add item to Zotero by DOI** - will add an item to your library based on a DOI that you provide (requires that you set up the integration using a Zotero token with write access)
- **Add note to Zotero** - adds a note to your library containing specified text. You must provide the Zotero Key for a parent item that the note is about (requires that you set up the integration using a Zotero token with write access).

## Limitations

- There is no way to disambiguate authors with identical names. If this is a serious problem for you, open an issue and we can try to brainstorm a solution (everything I've thought of so far is ugly).
- Similarly, the same author publishing under different names will show up as different authors. If you want to have a single entity for each author, I recommend making another database with a many-to-one connection to authors that links all pseudonyms for the same author to one entity.
- Fibery doesn't allow bi-directional syncing (yet), so all of the Zotero databases will be read-only. Once Fibery adds bi-directional syncing, it should not be too challenging for me to add it to this integration, as Zotero's API supports it nicely (as long as you don't edit the same item in multiple places).
- I've tried to handle errors carefully, but bibliographic data can be messy. If you have truly garbled entries in your library, you might need to clean them up for this integration to work properly. If you run into errors, feel free to open an issue.

## More information

- For more information on how to use integrations in Fibery, see [this guide](https://the.fibery.io/@public/User_Guide/Guide/Integration-Templates-68). Note that I have not made a template for this integration (yet - I can if there's interest), so it acts more like the Google Calendar or Clickup integrations than the ones that have templates.
- For more information on how to write your own template, see Fibery's documentation on the [integrations API](https://api.fibery.io/apps.html#integrations-api-overview) and [external actions API](https://api.fibery.io/external-actions.html#external-actions-api-overview)


## Support

This is mostly a fun side-project for me, so no promises, but if you encounter any problems or areas that would benefit from improvement, open an an issue and I'll see what I can do! Contributions are also welcome.

Also, I make absolutely no promises about the uptime, etc. of the hosted version of this integration. I'm running it for myself and am totally happy for others to use it as well, but I'm not sure how many people it can handle before it needs more resources.

Things that it would be very easy to add:

- Better support for item types other than books, conference papers, and journal papers (I just focused on these because they're the main things in my library)
- Filters on what parts of your library to sync to Fibery
