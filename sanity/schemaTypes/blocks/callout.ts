import {defineArrayMember, defineField, defineType} from "sanity";

export const callout = defineType({
  name: "callout",
  title: "Callout",
  type: "object",
  fields: [
    defineField({
      name: "tone",
      type: "string",
      options: {
        list: [
          {title: "Note", value: "note"},
          {title: "Warning", value: "warning"},
          {title: "Key point", value: "key"},
        ],
        layout: "radio",
      },
      initialValue: "note",
    }),
    defineField({name: "title", type: "string"}),
    defineField({
      name: "body",
      type: "array",
      of: [
        defineArrayMember({
          type: "block",
          // Headings inside a callout would break the article's heading order and
          // pollute the generated TOC, so only body copy and lists are allowed.
          styles: [{title: "Normal", value: "normal"}],
          lists: [
            {title: "Bullet", value: "bullet"},
            {title: "Numbered", value: "number"},
          ],
          marks: {
            decorators: [
              {title: "Strong", value: "strong"},
              {title: "Emphasis", value: "em"},
              {title: "Code", value: "code"},
            ],
          },
        }),
      ],
    }),
  ],
  preview: {
    select: {title: "title", tone: "tone"},
    prepare({title, tone}: {title?: string; tone?: string}) {
      return {title: title || "Callout", subtitle: `Callout · ${tone ?? "note"}`};
    },
  },
});
