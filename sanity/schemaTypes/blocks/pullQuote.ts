import {defineField, defineType} from "sanity";

export const pullQuote = defineType({
  name: "pullQuote",
  title: "Pull quote",
  type: "object",
  fields: [
    defineField({
      name: "text",
      type: "text",
      rows: 3,
      description: "Promote a sentence that already exists in the body — do not write new copy here.",
      validation: (r) => r.required(),
    }),
    defineField({name: "attribution", type: "string"}),
  ],
  preview: {
    select: {text: "text", attribution: "attribution"},
    prepare({text, attribution}: {text?: string; attribution?: string}) {
      return {
        title: text ? `“${text}”` : "Pull quote",
        subtitle: attribution ? `— ${attribution}` : "Pull quote",
      };
    },
  },
});
