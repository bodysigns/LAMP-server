import { DynamicAttachment } from "../../model"
//import { ScriptRunner } from "../../utils"
import { ParticipantModel } from "../../model/Participant"
import { StudyModel } from "../../model/Study"
import { ActivityModel } from "../../model/Activity"
import { SensorModel } from "../../model/Sensor"
import { ResearcherModel } from "../../model/Researcher"
import { TagsModel } from "../../model/Type"
import { Repository } from "../../repository/Bootstrap"
import { TypeInterface } from "../interface/RepositoryInterface"
// FIXME: Support application/json;indent=:spaces format mime type!

export class TypeRepository implements TypeInterface {
  public async _parent(type_id: string): Promise<{}> {
    const result: any = {} // obj['_parent'] === [null, undefined] -> top-level object
    const repo = new Repository()
    const TypeRepository = repo.getTypeRepository()
    for (const parent_type of await TypeRepository._parent_type(type_id))
      result[parent_type] = await TypeRepository._parent_id(type_id, parent_type)
    return result
  }

  public async _self_type(type_id: string): Promise<string> {
    try {
      const data: any = await (ParticipantModel.findOne({ _deleted: false, _id: type_id }) as any)
      if (null !== data) return "Participant"
    } catch (e) {}
    try {
      const data: any = await (ResearcherModel.findOne({ _deleted: false, _id: type_id }) as any)
      if (null !== data) return "Researcher"
    } catch (e) {}
    try {
      const data: any = await (StudyModel.findOne({ _deleted: false, _id: type_id }) as any)
      if (null !== data) return "Study"
    } catch (e) {}
    try {
      const data: any = await (ActivityModel.findOne({ _deleted: false, _id: type_id }) as any)
      if (null !== data) return "Activity"
    } catch (e) {}
    try {
      const data: any = await (SensorModel.findOne({ _deleted: false, _id: type_id }) as any)
      if (null !== data) return "Sensor"
    } catch (e) {}
    return "__broken_id__"
  }

  public async _owner(type_id: string): Promise<string | null> {
    try {
      return ((await ParticipantModel.findOne({ _deleted: false, _id: type_id })) as any)._parent
    } catch (e) {}
    try {
      const data: any = await (ResearcherModel.findOne({ _deleted: false, _id: type_id }) as any)
      if (null !== data) return null
    } catch (e) {}
    try {
      return ((await StudyModel.findOne({ _deleted: false, _id: type_id })) as any)._parent
    } catch (e) {}
    try {
      return ((await ActivityModel.findOne({ _deleted: false, _id: type_id })) as any)._parent
    } catch (e) {}
    try {
      return ((await SensorModel.findOne({ _deleted: false, _id: type_id })) as any)._parent
    } catch (e) {}
    return null
  }

  public async _parent_type(type_id: string): Promise<string[]> {
    const parent_types: { [type: string]: string[] } = {
      Researcher: [],
      Study: ["Researcher"],
      Participant: ["Study", "Researcher"],
      Activity: ["Study", "Researcher"],
      Sensor: ["Study", "Researcher"],
    }
    const repo = new Repository()
    const TypeRepository = repo.getTypeRepository()
    return parent_types[await TypeRepository._self_type(type_id)]
  }

  public async _parent_id(type_id: string, type: string): Promise<string> {
    const self_type: { [type: string]: Function } = {
      Researcher: Researcher_parent_id,
      Study: Study_parent_id,
      Participant: Participant_parent_id,
      Activity: Activity_parent_id,
      Sensor: Sensor_parent_id,
    }
    const repo = new Repository()
    const TypeRepository = repo.getTypeRepository()
    return await (self_type[await TypeRepository._self_type(type_id)] as any)(type_id, type)
  }

  public async _set(mode: any, type: string, type_id: string, key: string, value?: any): Promise<{}> {
    const deletion = value === undefined || value === null
    let existing: any = ""
    existing = await TagsModel.findOne({ _deleted: false, _parent: type_id, type: type, key: key })
    if (existing === null && !deletion) {
      try {
        await TagsModel.create([{
         _parent: type_id,
         type,
         key,
         value}],{checkKeys:false})
      } catch (e) {
        console.error(e)
        throw new Error("500.creation-or-update-failed")
      }
    } else if (existing !== null && !deletion) {
      try {
        const data: any = await TagsModel.findByIdAndUpdate(existing._id, { ...existing.value, value })
      } catch (e) {
        console.error(e)
        throw new Error("400.update-failed")
      }
    } else {
      // DELETE
      try {
        await TagsModel.updateOne({ _id: existing._id }, { _deleted: true })
      } catch (e) {
        console.error(e)
        throw new Error("400.deletion-failed")
      }
    }

    return {}
  }

  public async _get(mode: any, type_id: string, attachment_key: string): Promise<any | undefined> {
    const repo = new Repository()
    const TypeRepository = repo.getTypeRepository()
    const self_type = await TypeRepository._self_type(type_id)
    const parents = Object.values(await TypeRepository._parent(type_id)).reverse()

    // All possible conditions to retreive Tags, ordered greatest-to-least priority.
    const conditions = [
      // Explicit parent-ownership. (Ordered greatest-to-least ancestor.)
      ...parents.map((pid) => ({ _deleted: false, _parent: pid, type: type_id, key: attachment_key })),
      // Implicit parent-ownership. (Ordered greatest-to-least ancestor.)
      ...parents.map((pid) => ({ _deleted: false, _parent: pid, type: self_type, key: attachment_key })),
      // Explicit self-ownership.
      { _deleted: false, _parent: type_id, type: type_id, key: attachment_key },
      // Implicit self-ownership.
      { _deleted: false, _parent: type_id, type: "me", key: attachment_key },
    ]

    // Following greatest-to-least priority, see if the Tag exists. We do this because:
    // (1) Following priority order allows us to avoid searching the database after we find the
    //     Tag we're looking for that applies with the greatest priority.
    // (2) The CouchDB Mango Query API is NOT OPTIMIZED for $or queries that consist of
    //     multiple keys per-subquery; the difference is almost ~7sec vs. ~150ms.
    for (const condition of conditions) {
      try {
        const value = await TagsModel.find(condition).limit(1)
        if (value.length > 0) return value.map((x: any) => x._doc.value)[0]
      } catch (error) {
        console.error(error, `Failed to search Tag index for ${condition._parent}:${condition.type}.`)
      }
    }

    // No such Tag was found, so return an error (for legacy purposes).
    throw new Error("404.object-not-found")
  }

  public async _list(mode: any, type_id: string): Promise<string[]> {
    const repo = new Repository()
    const TypeRepository = repo.getTypeRepository()
    const self_type = await TypeRepository._self_type(type_id)
    const parents = Object.values(await TypeRepository._parent(type_id)).reverse()
    let conditions: any[] = []
    conditions = [
      // Explicit parent-ownership. (Ordered greatest-to-least ancestor.)

      ...parents.map((pid) => ({ _deleted: false, _parent: pid, type: type_id, key: { $ne: null } })),
      // Implicit parent-ownership. (Ordered greatest-to-least ancestor.)
      ...parents.map((pid) => ({ _deleted: false, _parent: pid, type: self_type, key: { $ne: null } })),
      // Explicit self-ownership.
      { _deleted: false, _parent: type_id, type: type_id, key: { $ne: null } },
      // Implicit self-ownership.
      { _deleted: false, _parent: type_id, type: "me", key: { $ne: null } },
    ]

    // Following greatest-to-least priority, see if the Tag exists. We do this because:
    // (1) Following priority order allows us to avoid searching the database after we find the
    //     Tag we're looking for that applies with the greatest priority.
    // (2) The CouchDB Mango Query API is NOT OPTIMIZED for $or queries that consist of
    //     multiple keys per-subquery; the difference is almost ~7sec vs. ~150ms.
    let all_keys: string[] = []
    for (const condition of conditions) {
      try {
        const value = await TagsModel.find(condition).limit(2_147_483_647)
        all_keys = [...all_keys, ...value.map((x: any) => x._doc.key as any)]
      } catch (error) {
        console.error(error, `Failed to search Tag index for ${condition._parent}:${condition.type}.`)
      }
    }

    // Return all the Tag keys we found; converting to a Set and back to an Array
    // removes any duplicates (i.e. parent-specified Tag taking precedence over self-Tag).
    // Else, if no such Tags were found, return an error (for legacy purposes).
    if (all_keys.length > 0) return [...new Set(all_keys)]
    else throw new Error("404.object-not-found")
  }

  /*public async _invoke(attachment: DynamicAttachment, context: any): Promise<any | undefined> {
    if ((attachment.contents || "").trim().length === 0) return undefined
    // Select script runner for the right language...
    let runner: ScriptRunner
    switch (attachment.language) {
      case "rscript":
        runner = new ScriptRunner.R()
        break
      case "python":
        runner = new ScriptRunner.Py()
        break
      case "javascript":
        runner = new ScriptRunner.JS()
        break
      case "bash":
        runner = new ScriptRunner.Bash()
        break
      default:
        throw new Error("400.invalid-script-runner")
    }
    // Execute script.
    return await runner.execute(attachment.contents!, attachment.requirements!.join(","), context)
  }*/

  /*public async _process_triggers(): Promise<void> {
    // FIXME: THIS FUNCTION IS DEPRECATED/OUT OF DATE/DISABLED (!!!)
    console.log("Processing accumulated attachment triggers...")

    // Request the set of all updates.
    const accumulated_set = (
      await SQL!.request().query(`
			SELECT 
				Type, ID, Subtype, 
				DATEDIFF_BIG(MS, '1970-01-01', LastUpdate) AS LastUpdate, 
				Users.StudyId AS _SID,
				Users.AdminID AS _AID
			FROM LAMP_Aux.dbo.UpdateCounter
			LEFT JOIN LAMP.dbo.Users
				ON Type = 'Participant' AND Users.UserID = ID
			ORDER BY LastUpdate DESC;
		`)
    ).recordset.map((x: any) => ({
      ...x,
      _id:
        x.Type === "Participant"
          ? Participant_pack_id({ study_id: x._SID }) // FIXME: Decrypt(<string>x._SID)
          : Researcher_pack_id({ admin_id: x.ID }),
      _admin:
        x.Type === "Participant" ? Researcher_pack_id({ admin_id: x._AID }) : Researcher_pack_id({ admin_id: x.ID }),
    }))
    const ax_set1 = accumulated_set.map((x: any) => x._id)
    const ax_set2 = accumulated_set.map((x: any) => x._admin)

    // Request the set of event masks prepared.
    const registered_set = (
      await SQL!.request().query(`
			SELECT * FROM LAMP_Aux.dbo.OOLAttachmentLinker; 
		`)
    ).recordset // TODO: SELECT * FROM LAMP_Aux.dbo.OOLTriggerSet;

    // Diff the masks against all updates.
    let working_set = registered_set.filter(
      (x: any) =>
        // Attachment from self -> self.
        (x.ChildObjectType === "me" && ax_set1.indexOf(x.ObjectID) >= 0) ||
        // Attachment from self -> children of type Participant
        (x.ChildObjectType === "Participant" && ax_set2.indexOf(x.ObjectID) >= 0) ||
        // Attachment from self -> specific child Participant matching an ID
        accumulated_set.find((y: any) => y._id === x.ChildObjectType && y._admin === x.ObjectID) !== undefined
    )

    // Completely delete all updates; we're done collecting the working set.
    // TODO: Maybe don't delete before execution?
    const result = await SQL!.request().query(`
            DELETE FROM LAMP_Aux.dbo.UpdateCounter;
		`)
    console.log("Resolved " + JSON.stringify(result.recordset) + " events.")

    // Duplicate the working set into specific entries.
    working_set = working_set
      .map((x: any) => {
        const script_type = x.ScriptType.startsWith("{")
          ? JSON.parse(x.ScriptType)
          : { triggers: [], language: x.ScriptType }

        const obj = new DynamicAttachment()
        obj.key = x.AttachmentKey
        obj.from = x.ObjectID
        obj.to = x.ChildObjectType
        obj.triggers = script_type.triggers
        obj.language = script_type.language
        obj.contents = x.ScriptContents
        obj.requirements = JSON.parse(x.ReqPackages)
        return obj
      })
      .map((x: any) => {
        // Apply a subgroup transformation only if we're targetting all
        // child resources of a type (i.e. 'Participant').
        if (x.to === "Participant")
          return accumulated_set
            .filter((y: any) => y.Type === "Participant" && y._admin === x.from && y._id !== y._admin)
            .map((y: any) => ({ ...x, to: y._id }))
        return [{ ...x, to: x.from as string }]
      })
    ;([] as any[]).concat(...working_set).forEach(async (x) =>
      TypeRepository._invoke(x, {
        // The security context originator for the script
        // with a magic placeholder to indicate to the LAMP server
        // that the script's API requests are pre-authenticated.
        token: await CredentialRepository._packCosignerData(x.from, x.to),

        // What object was this automation run for on behalf of an agent?
        object: {
          id: x.to,
          type: TypeRepository._self_type(x.to),
        },

        // Currently meaningless but does signify what caused the IA to run.
        event: ["ActivityEvent", "SensorEvent"],
      })
        .then((y) => {
          TypeRepository._set("a", x.to, x.from as string, x.key + "/output", y)
        })
        .catch((err) => {
          TypeRepository._set(
            "a",
            x.to,
            x.from as string,
            x.key + "/output",
            JSON.stringify({ output: null, logs: err })
          )
        })
    )
    // TODO: This is for a single item only;
    const type_id = ""
    const attachments: DynamicAttachment[] = await Promise.all(
      (await TypeRepository._list("b", type_id as string)).map(
        async (x) => await TypeRepository._get("b", type_id as string, x)
      )
    )
    attachments
      .filter((x) => !!x.triggers && x.triggers.length > 0)
      .forEach((x) =>
        TypeRepository._invoke(x, null).then((y: any) => {
          TypeRepository._set("a", x.to!, <string>x.from!, x.key! + "/output")
        })
      )
  }*/
}

async function Researcher_parent_id(id: string, type: string): Promise<string | undefined> {
  switch (type) {
    default:
      return undefined
    // throw new Error('400.invalid-identifier')
  }
}
async function Study_parent_id(id: string, type: string): Promise<string | undefined> {
  switch (type) {
    case "Researcher":
      const obj: any = await StudyModel.findOne({ _deleted: false, _id: id })
      return obj._parent

    default:
      throw new Error("400.invalid-identifier")
  }
}
async function Participant_parent_id(id: string, type: string): Promise<string | undefined> {
  let obj: any
  switch (type) {
    case "Study":
      obj = await ParticipantModel.findOne({ _deleted: false, _id: id })
      return obj._parent

    case "Researcher":
      obj = await ParticipantModel.findOne({ _deleted: false, _id: id })
      obj = await StudyModel.findOne({ _deleted: false, _id: obj._parent })
      return obj._parent

    default:
      throw new Error("400.invalid-identifier")
  }
}
async function Activity_parent_id(id: string, type: string): Promise<string | undefined> {
  let obj: any
  switch (type) {
    case "Study":
      obj = await ActivityModel.findOne({ _deleted: false, _id: id })
      return obj._parent

    case "Researcher":
      obj = await ActivityModel.findOne({ _deleted: false, _id: id })
      obj = await StudyModel.findOne({ _deleted: false, _id: obj._parent })
      return obj._parent

    default:
      throw new Error("400.invalid-identifier")
  }
}
async function Sensor_parent_id(id: string, type: string): Promise<string | undefined> {
  let obj: any
  switch (type) {
    case "Study":
      obj = await SensorModel.findOne({ _deleted: false, _id: id })
      return obj._parent

    case "Researcher":
      obj = await SensorModel.findOne({ _deleted: false, _id: id })
      obj = await StudyModel.findOne({ _deleted: false, _id: obj._parent })
      return obj._parent

    default:
      throw new Error("400.invalid-identifier")
  }
}