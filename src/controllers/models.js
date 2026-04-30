const { getLatestModels } = require('../models/models-map.js')
const config = require('../config/index.js')

/**
 * Build public model data
 * @param {object} model - Original model info
 * @param {string} suffix - Variant suffix
 * @returns {object} Public model info
 */
const buildPublicModelData = (model, suffix = '') => {
    const modelData = JSON.parse(JSON.stringify(model))
    const upstreamModelID = String(model?.id || '')
    const displayModelID = String(model?.name || model?.id || '')

    // Force lowercase for compatibility with clients that don't support uppercase model names
    modelData.id = `${displayModelID}${suffix}`.toLowerCase()
    modelData.name = `${upstreamModelID}${suffix}`.toLowerCase()
    modelData.upstream_id = upstreamModelID
    modelData.display_name = displayModelID

    return modelData
}

const handleGetModels = async (req, res) => {
    const models = []

    const ModelsMap = await getLatestModels()

    for (const model of ModelsMap) {
        models.push(buildPublicModelData(model))

        if (config.simpleModelMap) {
            continue
        }

        const isThinking = model?.info?.meta?.abilities?.thinking
        const isSearch = model?.info?.meta?.chat_type?.includes('search')
        const isImage = model?.info?.meta?.chat_type?.includes('t2i')
        const isVideo = model?.info?.meta?.chat_type?.includes('t2v')
        const isImageEdit = model?.info?.meta?.chat_type?.includes('image_edit')

        if (isThinking) {
            models.push(buildPublicModelData(model, '-thinking'))
        }

        if (isSearch) {
            models.push(buildPublicModelData(model, '-search'))
        }

        if (isThinking && isSearch) {
            models.push(buildPublicModelData(model, '-thinking-search'))
        }

        if (isImage) {
            models.push(buildPublicModelData(model, '-image'))
        }

        if (isVideo) {
            models.push(buildPublicModelData(model, '-video'))
        }

        if (isImageEdit) {
            models.push(buildPublicModelData(model, '-image-edit'))
        }
    }

    res.json({
        "object": "list",
        "data": models
    })
}

module.exports = {
    handleGetModels
}
