'use strict';

var path = require('path');
var Promise = require('q');
var parseNavigation = require('gitbook/lib/utils/navigation');
var fsUtil = require('gitbook/lib/utils/fs');

function setupSymlink(bookInstance, bookConfig) {
    var nestedName = bookConfig.nestedName;
    var bookRoot = path.resolve(bookInstance.root);
    var nestedBookRoot = path.resolve(bookConfig.path);
    var subFolder = path.join(bookRoot, nestedName);

    return fsUtil.exists(subFolder)
        .then(function(exists) {
            var next;
            if (!exists) {
                var rel = path.relative(bookRoot, nestedBookRoot);
                next = fsUtil.symlink(rel, subFolder, 'dir');
            } else {
                next = Promise.resolve(undefined);
            }
            return next;
        })
        .then(function() {
            return nestedName;
        });
}

/**
 * Method for modifying a chapter to update with the correct path and adjusted chapter level.
 */
function applyChapterModification(chapter, pathPrefix, startLevel, level) {
    /**
     * Join the parent level and the new level together with a dot.
     */
    chapter.level = [startLevel, level].join('.');
    if(chapter.path !== null){
        /**
         * Only if the path is not null do we prefix the existing path with the known folder name.
         */
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
    /**
     * Start indexing at 1 for chapters underneath the new main chapter
     */
    var level = 1;

    chapters.forEach(function(chapter){
        applyChapterModification(chapter, pathPrefix, startLevel, level);
        recurseArticles(chapter.articles, pathPrefix, chapter.level);
        level++;
    });
    /**
     * Return the updated summary, which is the same instance.
     */
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

/**
 * Method for detecting the new available chapter level in the gitbook.
 */
function getNextChapterLevel(bookInstance) {
    var chapters = bookInstance.summary.chapters;
    var chapterCount = chapters.length;
    var endChapter = chapters[chapterCount - 1];
    return (Number(endChapter.level) + 1);
}

function updateFiles(folderName, bookInstance) {
    var folderPath = folderName + '/';
    /**
     * Ignore files that we will manually process, such as the summary and glossary.
     */
    var ignores = ['SUMMARY.md', 'GLOSSARY.md', 'book.json'];
    /**
     * Using the fs utilities from gitbook, list out the files in the new directory.
     */
    return fsUtil.list(bookInstance.root + '/' + folderName, {ignoreFiles: ignores, ignoreRules: ignores})
        .then(function(foundFiles) {
            /**
             * For each of the files returned
             */
            return foundFiles
                /**
                 * ..correct the file path by appending the folder name
                 */
                .map(function(filePath) {
                    return folderPath + filePath;
                })
                /**
                 * ..ensure that the root directory is also in the list, so that it can be created
                 */
                .concat([folderPath]);
        })
        .then(function(newFiles) {
            /**
             * Get the array of files currently used by the book
             */
            var files = bookInstance.files;
            /**
             * ...and the index of the symlinked directory
             */
            var idx = files.indexOf(folderName);
            /**
             * Splice out the name of the symlink, and replace it with the new files.
             * This is because gitbook cannot copy a symlink, and will throw an error.
             */
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

/**
 * Method for processing a nested gitbook
 */
function processNestedBook(bookInstance, bookConfig) {
    /**
     * Setup the initial symlink to get the folder name
     */
    return setupSymlink(bookInstance, bookConfig)
        .then(function(folderName) {
            return Promise.all([
                folderName,
                getNextChapterLevel(bookInstance),
                updateFiles(folderName, bookInstance)
            ]);
        })
        .spread(function(folderName, nLevel, files) {
            return updateSummary(bookInstance, bookConfig, folderName, files, nLevel);
        });
}

/**
 * Exports the gitbook plugin
 */
module.exports = {
    hooks: {
        /**
         * The "init" hook is run after the book has been parsed, but before any pages have
         * been generated.
         */
        init: function() {
            /**
             * The function is invoked in the context of book.js which allows us to call it's methods.
             */
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
