import {defineField, defineType} from "sanity";

export const codeBlock = defineType({
  name: "codeBlock",
  title: "Code block",
  type: "object",
  fields: [
    defineField({
      name: "language",
      type: "string",
      options: {
        list: [
          {title: "Plain text", value: "text"},
          {title: "Bash", value: "bash"},
          {title: "JavaScript", value: "js"},
          {title: "TypeScript", value: "ts"},
          {title: "JSON", value: "json"},
          {title: "Python", value: "python"},
          {title: "HTML", value: "html"},
          {title: "CSS", value: "css"},
          {title: "SQL", value: "sql"},
        ],
      },
      initialValue: "text",
    }),
    defineField({
      name: "filename",
      type: "string",
      description: "Optional. Rendered as the tab label above the snippet.",
    }),
    defineField({
      name: "code",
      type: "text",
      rows: 12,
      validation: (r) => r.required(),
    }),
  ],
  preview: {
    select: {code: "code", language: "language", filename: "filename"},
    prepare({code, language, filename}: {code?: string; language?: string; filename?: string}) {
      return {
        title: filename || (code ?? "").split("\n")[0] || "Code block",
        subtitle: language ?? "text",
      };
    },
  },
});
