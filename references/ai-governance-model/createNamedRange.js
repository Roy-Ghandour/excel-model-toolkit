const fs = require('fs');

fs.readFile('namedRanges.txt', 'utf8', (err, data) => {
    if (err) {
        console.error(err);
        return;
    }
    const lines = data.split('\n').map((line) => line.trim());
    const formattedLines = JSON.stringify(lines);

    fs.writeFile('output.txt', formattedLines, (err) => {
        if (err) {
            console.error(err);
            return;
        }
        console.log('File has been saved!');
    });
});
