// scrape.js
// world rugby laws scraper

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const baseUrl = 'https://laws.worldrugby.org/';

const formatSanction = sanction => {
    return sanction.children[1].data;
};

const olSubClause = item => {    
    const el = cheerio(item);
    const subsection = [];
    const sanctions = [];

    el.children().each((i, child) => {

        if (child.name === 'li') {
            const paragraph = {};
            paragraph.value = child.children[0].data.trim();
            
            // inline sanctions
            if (child.children.length > 1 && child.children[1].attribs != null && child.children[1].attribs.class.includes('sanction')) {
                if (!paragraph.sanctions) paragraph.sanctions = [];
                child.children.forEach((item, i) => {
                    if (item.attribs != null && item.attribs.class.includes('sanction_grade_') && !item.attribs.class.includes('sanction_bold') && !item.children[0].data.includes('choose')) {
                        // console.log(item, item.text)
                        paragraph.sanctions.push(item.children[0].data);
                    } else if (item.name == 'ol') {
                        // if there's more than one sanction, there's an ol.roman list of them
                        item.children.forEach((child, j) => {
                            if (child.name == 'li') {
                                paragraph.sanctions.push(child.children[0].data);
                            }
                        })
                    }
                });
            }

            if (child.next.next && child.next.next.name === 'ol') {
                paragraph.clauses = [];
                child.next.next.children.filter(el => el.type == 'tag').forEach((child, i) => {
                    if (child.name == 'li') {
                        // assume child[0] is a text node
                        paragraph.clauses.push({
                            "value": child.children[0].data.trim()
                        });
                    }
                });
            }
            subsection.push(paragraph);

        } else if (child.attribs !== null && child.name === 'div' && child.attribs.class.trim() == 'law_text_clip_wrap') {
            paragraph =  subsection.pop();
            paragraph.video = {};
            child.children.forEach((item, i) => {
                if (item.name === 'video'){
                    paragraph.video.poster = baseUrl + item.attribs.poster;
                    item.children.forEach((gchild, x) => {
                        if (gchild.name === 'source') {
                            paragraph.video.src = baseUrl + gchild.attribs.src;
                            paragraph.video.type = gchild.attribs.type;
                        }
                    });
                }
            });
            subsection.push(paragraph);
        }
        else if (child.name == 'div' && child.attribs.class.includes('sanction')) {

            child.children.forEach((subchild, i) => {
                if (subchild.attribs !== null && subchild.attribs.class.includes('sanction_grade_') && !subchild.attribs.class.includes('sanction_bold')) {
                    sanctions.push(subchild.children[0].data);
                }
            });
            // sanctions.push(formatSanction(child));
        }
        
    });
    // console.log({ "subsection": subsection, "sanctions": sanctions.reverse() });
    return { "subsection": subsection, "sanctions": sanctions.reverse() };
};

const lawToJson = response => {
    const html = response.data;
    const $ = cheerio.load(html);
    const content = $('div#content');
    const title = $('.law_title').text();
    const laws = $('ol.number').children();

    const data = [];
    let count = 0;
    let obj = {};
    const lawElements = content.find('ol.number').children();
    lawElements.each((index, item) => {
        let el = $(item);

        // console.log(item.name, item.type, el.attr('id'), el.attr('class'));

        if (item.name === 'p' && el.hasClass('section')) {
            let section = {
                "type": "section",
                "data": {
                    "title": el.text()
                }
            }
            if (el.next().next().hasClass('para')) {
                section.data.para = el.next().next().text().trim();
            }
            
            data.push(section);
            return;
        } 

        if (item.name === 'li') {
            count++;

            // strip out inline sanctions
            let wording = el.text().trim();
            if (el.text().includes('Sanction')) {
                wording = wording.substr(0, wording.indexOf('Sanction'))
            }

            const schedule = {
                "type": "schedule",
                "data": {
                    "number": count,
                    "text": wording
                }
            };

            // check for sanction
            if (item.children.length > 1 && item.children[1].attribs.class.includes('sanction')) {
                if (!schedule.data.sanctions) schedule.data.sanctions = [];
                schedule.data.sanctions.push(item.children[2].children[0].data);
            }

            data.push(schedule);

        } else if (item.name === 'img' && el.hasClass('lawsimage')) {
            let latestObj = data.pop();
            if (!latestObj.data.hasOwnProperty('images')) {
                latestObj.data.images = [];
            }
            let img = {
                "src": baseUrl + el.attr('src')
            };
            // check for caption. the "next" is always a text node, so we check next.next
            if (el.hasClass('withcaption') && el.next().next().hasClass('diagram_caption')) {
                img.caption = $(item.next.next).text().trim();
            }
            latestObj.data.images.push(img);
            data.push(latestObj);

        } else if (item.name === 'table') {
            let latestObj = data.pop();
            latestObj.data.table =  el.children().children().filter((i, row) => {
                return row.attribs.class == false;
            }).map((i, row) => {
                return [
                    $(row).children().map((j, cell) => {
                        return $(cell).text();
                    }).toArray()
                ];
            }).toArray();
            data.push(latestObj);

        } else if (item.name === 'ol') {
            let latestObj = data.pop();
            let { subsection, sanctions } = olSubClause(item);
            latestObj.data.subsections = subsection;
            if (sanctions.length > 0) latestObj.data.sanctions = sanctions;
            data.push(latestObj);
        }  
    });
    const titleAr = title.split(' ');

    return { "number": parseInt(titleAr.shift()) ,"law": titleAr.join(' '), "schedules": data };
}

const laws = [];
const getOneLaw = law => {
    const url = `${baseUrl}index.php?law=${law}&language=EN`;

    return axios(url)
        .then(lawToJson)
        .catch(console.error);
};

const getAllLaws = () => {
    const numbers = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21];

    const laws = []
    Promise.all(
            numbers.map(law => {
                return getOneLaw(law);
            })
        ).then(json => {
            laws.push(json);
        }).then(() => {
            fs.writeFile("laws.txt", JSON.stringify(laws, null, 2), err => {
              if (err) throw err;
              console.log('Saved!');
            })
        });
};

var args = process.argv.slice(2);

if (args[0] === 'all') {
    getAllLaws();
} else if (parseInt(args[0]) > 0 && parseInt(args[0]) < 22) {
    const lawNum = parseInt(args[0]);
    getOneLaw(lawNum).then(json => fs.writeFile(`law-${json.number.toString()}.txt`, JSON.stringify(json, null, 2), err => {
        if (err) throw err;
        console.log(`Law saved to file law-${json.number.toString()}.txt`);
    }));
} else {
    console.log('No argument passed.');
}