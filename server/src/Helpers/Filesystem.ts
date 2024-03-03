import fs from "node:fs";
import path from "node:path";

/**
 * Calculates the size of a directory in bytes.
 * @param dir - The path to the directory.
 * @returns The size of the directory in bytes.
 */
export function directorySize(dir: string): number {
    let size = 0;
    for (const file of fs.readdirSync(dir)) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            size += directorySize(filePath);
        } else {
            size += stat.size;
        }
    }
    return size;
}

/*
export function sanitizeAbsolutePath(dir: string): string {
    
}

export function sanitizeRelativePath(dir: string): string {

    dir = path.normalize(dir);

    // linux
    if (dir.startsWith("/")) {
        dir = dir.substring(1);
    }

    // windows
    if (dir.match(/^[a-zA-Z]:\\/)) {
        dir = dir.substring(3);
    }




    
}

export function sanitizeFilename(filename: string): string {
    return filename.replace(/[\\/:*?"<>|]/g, "_");
}
*/

export function validateAbsolutePath(dir: string): boolean {
    // return path.isAbsolute(dir) && !dir.match(/\0/);
    const normalDir = path.normalize(dir);
    if (normalDir.match(/\0/)) return false;
    return (
        path.isAbsolute(normalDir) ||
        normalDir.startsWith("/") ||
        new RegExp(/^[a-zA-Z]:\\/).test(normalDir)
    );
}

/**
 * Validates whether a given directory path is a relative path.
 *
 * @param dir - The directory path to validate.
 * @returns A boolean indicating whether the directory path is relative or not.
 */
export function validateRelativePath(dir: string): boolean {
    return (
        !path.isAbsolute(dir) &&
        // windows drive
        !dir.match(/^[a-zA-Z]:\\/) &&
        // linux root
        !dir.startsWith("/") &&
        // parent directory, but double dots can be part of the filename
        !dir.match(/[^\\]\\\.\.($|\\)/) &&
        !dir.startsWith("..\\") &&
        !dir.startsWith("../") &&
        // current directory
        !dir.match(/[^\\]\\\.($|\\)/) &&
        // null character
        !dir.match(/\0/)
    );
}

/**
 * Validates a filename to ensure it does not contain any invalid characters.
 * @param filename - The filename to validate.
 * @returns True if the filename is valid, false otherwise.
 */
export function validateFilename(filename: string): boolean {
    return !/[\\/:*?"<>|\0]/.test(filename);
}

/**
 * Replaces any invalid characters in a file path with an underscore. Does not prevent directory traversal.
 * @param dir - The file path to sanitize.
 * @returns The sanitized file path.
 */
export function sanitizePath(dir: string): string {
    return dir.replace(/[:*?"<>|\0]/g, "_");
}
