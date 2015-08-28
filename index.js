'use strict';

var fs = require('fs');
var path = require('path');
var Promise = require('es6-promise').Promise;
var glob = require('glob');
var parseNavigation = require('gitbook/lib/utils/navigation');

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

    return nestedName;
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

function processNestedBook(bookInstance, bookConfig) {

    var folderName = setupSymlink(bookInstance, bookConfig);

    var chapters = bookInstance.summary.chapters;
    var chapterCount = chapters.length;
    var endChapter = chapters[chapterCount - 1];
    var nLevel = (Number(endChapter.level) + 1);

    var files = bookInstance.files;

    var docRoot = path.relative(process.cwd(), bookInstance.root);
    var nFiles = glob.sync(folderName + '/**/!(SUMMARY|GLOSSARY).md', {cwd: docRoot});
    nFiles.push(folderName + '/');

    var idx = files.indexOf(folderName);
    // splice out the name of the symlink
    if (idx !== -1) {
       files.splice.bind(files, idx, 1).apply(null, nFiles);
    }

    // grab the summary from the nested book
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
