import {defineField, defineType} from "sanity";

export const divider = defineType({
  name: "divider",
  title: "Divider",
  type: "object",
  fields: [
    defineField({
      name: "style",
      type: "string",
      options: {
        list: [
          {title: "Rule", value: "rule"},
          {title: "Dither", value: "dither"},
          {title: "Asterism", value: "asterism"},
        ],
        // Radio rather than a dropdown: three options, and the editor should see
        // all of them without a click.
        layout: "radio",
      },
      initialValue: "rule",
    }),
  ],
  preview: {
    select: {style: "style"},
    prepare({style}: {style?: string}) {
      return {title: "Divider", subtitle: style ?? "rule"};
    },
  },
});
