'use strict';

var fs = require('fs');
var path = require('path');
var Promise = require('es6-promise').Promise;
var parseNavigation = require('gitbook/lib/utils/navigation');
var fsUtil = require('gitbook/lib/utils/fs');

function setupSymlink(bookInstance, bookConfig) {
    var nestedName = bookConfig.nestedName;
    var bookRoot = path.resolve(bookInstance.root);
    var nestedBookRoot = path.resolve(bookConfig.path);
    var subFolder = path.join(bookRoot, nestedName);

    var exists = fs.existsSync(subFolder);
    if (!exists) {
        var rel = path.relative(bookRoot, nestedBookRoot);
        fs.symlinkSync(rel, subFolder, 'dir');
    }

    return Promise.resolve(nestedName);
}

function applyChapterModification(chapter, pathPrefix, startLevel, level) {
    chapter.level = [startLevel, level].join('.');

    if(chapter.path !== null){
        chapter.path = [pathPrefix, chapter.path].join('/');
    }
}

function recurseArticles(articles, pathPrefix, level) {
    var exp = /(.+?)(\.[0-9]+$)/i;
    articles.forEach(function(article) {
        if(article.path !== null){
            article.path = [pathPrefix, article.path].join('/');
        }

        var nLevel = article.level.replace(exp, level + '$2');
        article.level = nLevel;

        if (article.articles.length > 0) {
            recurseArticles(article.articles, pathPrefix, article.level);
        }
    });
}

function recursivelyAdjustLevels(summary, startLevel, pathPrefix) {

    var chapters = summary.chapters;

    var level = 1;

    chapters.forEach(function(chapter){
        applyChapterModification(chapter, pathPrefix, startLevel, level);
        recurseArticles(chapter.articles, pathPrefix, chapter.level);
        level++;
    });

    return summary;
}

function createNewChapter(bookConfig, level, chapters) {
    return { path: null,
        title: bookConfig.title,
        level: level.toString(),
        articles: chapters,
        exists: false,
        external: false,
        introduction: false };
}

function getNextChapterLevel(bookInstance) {
    var chapters = bookInstance.summary.chapters;
    var chapterCount = chapters.length;
    var endChapter = chapters[chapterCount - 1];
    return (Number(endChapter.level) + 1);
}

function updateFiles(folderName, bookInstance) {
    var folderPath = folderName + '/';
    var ignores = ['SUMMARY.md', 'GLOSSARY.md', 'book.json'];
    // list all the files in the new folder
    return fsUtil.list(bookInstance.root + '/' + folderName, {ignoreFiles: ignores, ignoreRules: ignores})
        .then(function(foundFiles) {
            return foundFiles
                // correct the file path by appending the folder name
                .map(function(filePath) {
                    return folderPath + filePath;
                })
                // ensure that the root directory is also in the list
                .concat([folderPath]);
        })
        .then(function(newFiles) {
            var files = bookInstance.files;

            var idx = files.indexOf(folderName);
            // splice out the name of the symlink, and replace it with the new files
            if (idx !== -1) {
                files.splice.bind(files, idx, 1).apply(null, newFiles);
            }

            return files;
        });
}

function updateSummary(bookInstance, bookConfig, folderName, files, nLevel) {
    return bookInstance.findFile(folderName + '/SUMMARY').then(function(summary){
        var summaryFile = summary.path;
        return bookInstance.template.renderFile(summaryFile)
            .then(function(content) {
                return summary.parser.summary(content);
            })
            .then(function(parsed){
                return recursivelyAdjustLevels(parsed, nLevel, folderName);
            }).then(function(nSummary){
                var nChapter = createNewChapter(bookConfig, nLevel, nSummary.chapters);
                bookInstance.summary.chapters.push(nChapter);

                var navigation = parseNavigation(bookInstance.summary, files);
                bookInstance.navigation = navigation;
            });
    });
}

function processNestedBook(bookInstance, bookConfig) {
    return setupSymlink(bookInstance, bookConfig)
        .then(function(folderName) {
            return Promise.all([
                folderName,
                getNextChapterLevel(bookInstance),
                updateFiles(folderName, bookInstance)
            ]);
        })
        .then(function(args) {
            var folderName = args[0], nLevel = args[1], files = args[2];
            return updateSummary(bookInstance, bookConfig, folderName, files, nLevel);
        });
}

module.exports = {
    hooks: {
        init: function() {
            var book = this;
            var config = book.options.pluginsConfig['nested-book'];

            return config.books.reduce(function(prev, bookConfig){
                return prev.then(function(){
                    return processNestedBook(book, bookConfig);
                });
            }, Promise.resolve(null));
        }
    }
};
