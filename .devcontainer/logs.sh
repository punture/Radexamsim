#!/usr/bin/env bash
# Runs whenever the editor connects (postAttachCommand): follows the app log in a terminal.
# GitHub counts terminal output as activity, so the codespace stays awake while the site is in
# use and the editor tab is open. It stops after your idle timeout once the activity ends.
cd "$(dirname "$0")/.."
mkdir -p var/log
touch var/log/codespace-dev.log
echo "Following var/log/codespace-dev.log. Ctrl+C stops following; the app keeps running."
exec tail -n 40 -F var/log/codespace-dev.log
