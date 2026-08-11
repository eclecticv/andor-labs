import {callout} from "./callout";
import {codeBlock} from "./codeBlock";
import {divider} from "./divider";
import {figure} from "./figure";
import {keyStat} from "./keyStat";
import {pullQuote} from "./pullQuote";

export {callout, codeBlock, divider, figure, keyStat, pullQuote};

// Registered as top-level object types so `post.body` can reference them by name
// rather than inlining six definitions into one array.
export const blockTypes = [pullQuote, divider, callout, codeBlock, figure, keyStat];
