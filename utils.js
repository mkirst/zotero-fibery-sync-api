const uuid = require(`uuid-by-string`);

function processAuthor(a) {
    if (a.firstName === undefined) {
        a.firstName = "";
        a.middleName = ""
    } else {
        var split_name = a.firstName.replace(/\s/g, " ").split(" ");
        a.firstName = split_name[0];
        if (split_name.length > 1) {
            a.middleName = split_name.slice(1).join(" ");
        } else {
            a.middleName = "";
        }
    }
    a.name = a.firstName + " " + a.middleName + " " + a.lastName;
    a.name = a.name.replace(/\s/g, " ");
    a.id = uuid(JSON.stringify(a.name));
}

function processBibKey(meta, bibKeys) {
    console.log(meta);
    let originalEntry = meta.creatorSummary + " " + meta.parsedDate; //.substring(0, 4);
    let suffix = '';
    let count = 1;
    let entry = originalEntry;

    // Check if the entry already exists in bibKeys
    while (bibKeys.includes(entry)) {
        // Append a lowercase letter as a suffix
        suffix = ' ' + String.fromCharCode(96 + count); // 96 corresponds to 'a' in ASCII
        entry = originalEntry + suffix;
        count++;
    }

    return entry;
}

function processLiterature(data, item) {
    data.title = data.title;
    data.link = item.links.alternate.href;
    data.key = item.key;
    data.authorId = [];
    if ("creators" in data) {
        for (a of data.creators) {
            if (a.creatorType != "author") {
                continue;
            }
            processAuthor(a);
            data.authorId.push(a.id);
        }
    }
    if ("publicationTitle" in data) {
        data.venueId = uuid(JSON.stringify(data.publicationTitle));
    } else if ("conferenceName" in data && data.conferenceName != "") {
        data.venueId = uuid(JSON.stringify(data.conferenceName));
    } else if ("proceedingsTitle" in data) {
        data.venueId = uuid(JSON.stringify(data.proceedingsTitle));
    } else if ("bookTitle" in data) {
        data.venueId = uuid(JSON.stringify(data.bookTitle));
    } else {
        data.venueId = uuid(JSON.stringify(data.itemType));
    }

    data.tagId = [];
    for (a of data.tags) {
        a.id = uuid(JSON.stringify(a.tag));
        data.tagId.push(a.id);
    }
    data.__syncAction = "SET";    
}

function processTag(item) {
    item.name = item.tag;

    item.id = uuid(JSON.stringify(item.name));
    item.type = item.meta.type;
    item.link = item.links.alternate.href;

    item.__syncAction = "SET";    
}

function processNote(data, item) {
    data.name = data.key;
    data.id = uuid(JSON.stringify(data.key));
    data.literatureId = uuid(JSON.stringify(data.parentItem));
    data.link = item.links.alternate.href;
    if ("createdByUser" in item.meta) {
        data.creator = item.meta.createdByUser.name;
    } else {
        data.creator = "";
    }

    data.__syncAction = "SET";    
}

function populateJSONObj(json_obj, output) {
    json_obj.title = output[0].title;
    json_obj.date = output[0].issued["date-parts"][0][0];

    if ("volume" in json_obj && "volume" in output[0]) {
        json_obj.volume = output[0].volume;
    }

    if ("url" in json_obj && "URL" in output[0]) {
        json_obj.url = output[0].URL;
    }

    if ("publisher" in json_obj && "publisher" in output[0]) {
        json_obj.publisher = output[0].publisher;
    }

    if ("abstractNote" in json_obj && "abstract" in output[0]) {
        json_obj.abstractNote = output[0].abstract;
    }

    if ("pages" in json_obj && "page" in output[0]) {
        json_obj.pages = output[0].page;
    }

    if ("issue" in json_obj && "issue" in output[0]) {
        json_obj.issue = output[0].issue;
    }

    if ("ISSN" in json_obj && "ISSN" in output[0]) {
        json_obj.ISSN = output[0].ISSN;
    }

    if ("ISBN" in json_obj && "ISBN" in output[0]) {
        json_obj.ISBN = output[0].ISBN;
    }

    let counter = 0;
    for (author of output[0].author) {
        new_author = JSON.parse(JSON.stringify(json_obj.creators[0]));
        new_author.firstName = author.given;
        new_author.lastName = author.family;
        if (counter >= 1) {
            json_obj.creators.push(new_author);
        } else {
            json_obj.creators[0] = new_author;
        }
        counter++;
    }

    if (output[0].type == "article-journal") {
        json_obj.DOI = output[0].DOI;
        json_obj.publicationTitle = output[0]["container-title"];            
    } else if (output[0].type == "paper-conference") {
        json_obj.DOI = output[0].DOI;
        json_obj.conferenceName = output[0]["event-title"];
        json_obj.proceedingsTitle = output[0]["container-title"];
    } else {
        json_obj.extra = "DOI: " + output[0].DOI;
    }

}

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

async function handleBackoff(header) {
    if ("Backoff" in header) {
        console.log("Backing off...");
        await wait(header.Backoff);
    }
    if ("Retry-After" in header) {
        return header["Retry-After"];
    }
    return 0;
}

function handleDeletes(deleted, requestedType, items) {
    // This technically handles both literature and notes
    if (requestedType == "literature") {
        for (var item of deleted["items"]) {
            items.push({
                id: uuid(JSON.stringify(item)),
                __syncAction: "REMOVE"
            })
        }
    } else if (requestedType == "tag") {
        for (var item of deleted["tags"]) {
            items.push({
                id: uuid(JSON.stringify(item)),
                __syncAction: "REMOVE"
            })
        }        
    }
}

module.exports = {processAuthor, processBibKey, processLiterature, processNote, processTag, populateJSONObj, handleBackoff, handleDeletes};    
