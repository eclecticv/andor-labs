import {author} from "./author";
import {blockTypes} from "./blocks";
import {post} from "./post";

export const schemaTypes = [post, author, ...blockTypes];
