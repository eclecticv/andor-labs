import {defineField, defineType} from "sanity";

export const keyStat = defineType({
  name: "keyStat",
  title: "Key stat",
  type: "object",
  fields: [
    defineField({
      name: "value",
      type: "string",
      // String, not number: the display form carries meaning ("3.4x", "~40%",
      // "$1.2B") and rounding it into a number loses that.
      description: 'The figure as it should read, e.g. "3.4x".',
      validation: (r) => r.required(),
    }),
    defineField({name: "label", type: "string", validation: (r) => r.required()}),
    defineField({name: "source", type: "string", description: "Optional. Publication or link the figure comes from."}),
  ],
  preview: {
    select: {value: "value", label: "label"},
    prepare({value, label}: {value?: string; label?: string}) {
      return {title: value || "Key stat", subtitle: label ?? "Key stat"};
    },
  },
});
