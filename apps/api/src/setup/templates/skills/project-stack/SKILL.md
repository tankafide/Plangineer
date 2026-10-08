---
name: project-stack
description: The repository's context, stack, layout, commands and conventions, the one place every other skill links to for them. Use when planning, implementing or reviewing any change that needs a stack fact, a path or a command.
disable-model-invocation: true
---

# Project stack

The repository's facts that every other skill links to instead of restating them: what it builds, its stack, where code lives, the commands to run and the conventions it follows. A change to any of these updates this skill in the same change.

## Context

<!-- slot: fact context: what the repository builds, for whom, and its current stage, in at most three sentences -->

## Stack

<!-- slot: fact stack: a table of language, runtime, frameworks, main libraries and tools, each with the version the repository pins -->

## Layout

<!-- slot: fact layout: a table with one row per top-level app, package or source folder: its path, what it holds and what it may import -->

## Commands

<!-- slot: fact commands: a table with one row per command (name, command, what it does), including a row named check: the one command that must pass before work is done -->

## Conventions

<!-- slot: fact conventions: one line per convention the repository follows, such as file and identifier naming, error handling, logging, formatting and commit messages -->
